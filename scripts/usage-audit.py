#!/usr/bin/env python3
"""
usage-audit — read-only token-usage audit for opencode sessions.

Reports the four numbers that matter (calls, context/call, cache reads, read
hogs) plus a cause breakdown, straight from opencode's local sqlite DB.
Safe to run anytime: opens the DB read-only, never writes.

Usage:
  python3 usage-audit.py --last              # most recently updated session
  python3 usage-audit.py --session <id>      # a specific session
  python3 usage-audit.py --top 5             # rank recent sessions by cache reads
  python3 usage-audit.py --top 5 --json      # machine-readable

DB path: ~/.local/share/opencode/opencode.db (override with OPENCODE_DB).
"""
import argparse
import json
import os
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

DB = Path(os.environ.get("OPENCODE_DB", Path.home() / ".local/share/opencode/opencode.db"))


def connect() -> sqlite3.Connection:
    if not DB.exists():
        sys.exit(f"no opencode db at {DB}")
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


def fmt(n: float) -> str:
    if n >= 1e6:
        return f"{n/1e6:.1f}M"
    if n >= 1e3:
        return f"{n/1e3:.0f}k"
    return f"{n:.0f}"


def effective_fresh(input_tok: int, cache_read: int, cache_write: int) -> float:
    """Cost-normalized input: cache reads ~0.1x, writes ~1.25x (5-min TTL,
    Anthropic list; other providers similar). This is the number that maps to
    money — raw cache_read does not."""
    return input_tok + 0.1 * cache_read + 1.25 * cache_write


def session_rows(c: sqlite3.Connection, limit: int = 20):
    return c.execute(
        """select id, title, model, cost, tokens_input, tokens_output,
                  tokens_cache_read, tokens_cache_write, time_updated
           from session
           where tokens_cache_read > 0 or tokens_input > 0
           order by time_updated desc
           limit ?""",
        (limit,),
    ).fetchall()


def part_series(c: sqlite3.Connection, sid: str):
    """Per-call token series + part-level byte hogs, from the parts table."""
    try:
        rows = c.execute(
            """select p.data from part p
                join message m on m.id = p.message_id
                where p.session_id = ? and p.data like '%step-finish%'
                order by p.time_created""",
            (sid,),
        ).fetchall()
    except sqlite3.Error:
        return None, None
    calls = []
    for (data,) in rows:
        try:
            p = json.loads(data)
        except Exception:
            continue
        if p.get("type") != "step-finish" or not p.get("tokens"):
            continue
        t = p["tokens"]
        calls.append(
            {
                "input": t.get("input", 0),
                "output": t.get("output", 0),
                "cache_read": t.get("cache", {}).get("read", 0),
                "total": t.get("total", 0),
            }
        )
    hogs = defaultdict(int)
    cnt = Counter()
    images = []
    try:
        rows2 = c.execute(
            """select p.data from part p
                join message m on m.id = p.message_id
                where p.session_id = ?""",
            (sid,),
        ).fetchall()
    except sqlite3.Error:
        rows2 = []
    for (data,) in rows2:
        try:
            p = json.loads(data)
        except Exception:
            continue
        if p.get("type") != "tool":
            continue
        tool = p.get("tool", "?")
        size = len(data)
        hogs[tool] += size
        cnt[tool] += 1
        if tool == "read":
            fp = p.get("state", {}).get("input", {}).get("filePath", "?")
            if fp.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
                images.append((size, fp))
    top_files = Counter()
    try:
        rows3 = c.execute(
            """select p.data from part p
                join message m on m.id = p.message_id
                where p.session_id = ? and p.data like '%"tool":"read"%'""",
            (sid,),
        ).fetchall()
    except sqlite3.Error:
        rows3 = []
    for (data,) in rows3:
        try:
            p = json.loads(data)
        except Exception:
            continue
        if p.get("type") != "tool" or p.get("tool") != "read":
            continue
        fp = p.get("state", {}).get("input", {}).get("filePath", "?")
        top_files[fp] += len(data)
    return calls, {"tools": hogs, "counts": cnt, "top_files": top_files, "images": sorted(images, reverse=True)}


def med(xs):
    if not xs:
        return 0
    s = sorted(xs)
    return s[len(s) // 2]


def audit(sid: str) -> dict:
    c = connect()
    r = c.execute(
        """select id, title, model, cost, tokens_input, tokens_output,
                  tokens_cache_read, tokens_cache_write, time_updated
           from session where id = ?""",
        (sid,),
    ).fetchone()
    if not r:
        sys.exit(f"no session {sid}")
    calls, hogs = part_series(c, sid)
    out = {
        "session": r["id"],
        "title": r["title"],
        "model": json.loads(r["model"]).get("id") if r["model"] else None,
        "totals": {
            "input": r["tokens_input"] or 0,
            "output": r["tokens_output"] or 0,
            "cache_read": r["tokens_cache_read"] or 0,
            "cache_write": r["tokens_cache_write"] or 0,
            "effective_fresh": effective_fresh(
                r["tokens_input"] or 0, r["tokens_cache_read"] or 0, r["tokens_cache_write"] or 0
            ),
            "cost_usd": r["cost"] or 0,
        },
    }
    if calls:
        out["calls"] = len(calls)
        for k in ("input", "cache_read", "total"):
            xs = [x[k] for x in calls]
            out[f"per_call_{k}"] = {
                "min": min(xs),
                "median": med(xs),
                "max": max(xs),
            }
        # first-call floor ~= system prompt + tools + skills tax
        out["first_call_total"] = calls[0]["total"]
    if hogs:
        out["tool_bytes"] = {k: v for k, v in sorted(hogs["tools"].items(), key=lambda kv: -kv[1])}
        out["top_file_reads"] = [
            (fp, b) for fp, b in hogs["top_files"].most_common(10)
        ]
        out["image_attachments"] = [
            (fp, b) for b, fp in hogs["images"][:6]
        ]
    c.close()
    return out


def rank(top: int) -> list:
    c = connect()
    rows = session_rows(c, top)
    out = []
    for r in rows:
        model = None
        try:
            model = json.loads(r["model"]).get("id") if r["model"] else None
        except Exception:
            pass
        out.append(
            {
                "id": r["id"],
                "title": (r["title"] or "")[:60],
                "model": model,
                "input": r["tokens_input"] or 0,
                "output": r["tokens_output"] or 0,
                "cache_read": r["tokens_cache_read"] or 0,
                "effective_fresh": effective_fresh(
                    r["tokens_input"] or 0, r["tokens_cache_read"] or 0, r["tokens_cache_write"] or 0
                ),
            }
        )
    c.close()
    return out


def main():
    ap = argparse.ArgumentParser(description="audit opencode session token usage")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--last", action="store_true", help="most recently updated session")
    g.add_argument("--session", metavar="ID", help="session id")
    g.add_argument("--top", type=int, metavar="N", help="rank the N most recent sessions")
    ap.add_argument("--json", action="store_true", help="raw json output")
    args = ap.parse_args()

    if args.top:
        rows = rank(args.top)
        if args.json:
            print(json.dumps(rows, indent=2))
            return
        rows.sort(key=lambda r: -r["effective_fresh"])
        print(f"{'effective':>12} {'cache_read':>10} {'input':>8}  title")
        for r in rows:
            print(
                f"{fmt(r['effective_fresh']):>12} {fmt(r['cache_read']):>10} {fmt(r['input']):>8}  "
                f"{r['title']}  ({r['id'][4:16]}…)  {r['model']}"
            )
        return

    sid = None
    if args.session:
        sid = args.session
    elif args.last:
        c = connect()
        r = c.execute("select id from session order by time_updated desc limit 1").fetchone()
        c.close()
        sid = r["id"] if r else None
    if not sid:
        sys.exit("no session found")
    a = audit(sid)
    if args.json:
        print(json.dumps(a, indent=2))
        return

    t = a["totals"]
    eff = t["effective_fresh"]
    print(f"session : {a['session']}  «{a['title']}»")
    print(f"model   : {a['model']}")
    print(f"totals  : input {fmt(t['input'])}  output {fmt(t['output'])}  "
          f"cache_read {fmt(t['cache_read'])}  cache_write {fmt(t['cache_write'])}")
    print(f"effective fresh tokens: {fmt(eff)}   (input + 0.1·cache_read + 1.25·cache_write — the money number)   cost ${t['cost_usd']:.4f}")
    if "calls" in a:
        p = a["per_call_total"]
        c = a["per_call_cache_read"]
        print(f"calls   : {a['calls']}   context/call min {fmt(p['min'])} med {fmt(p['median'])} max {fmt(p['max'])}")
        print(f"cacheR  : per-call med {fmt(c['median'])}  (first-call total {fmt(a['first_call_total'])} = system floor)")
        ratio = t["cache_read"] / max(1, t["input"] + t["output"])
        print(f"cache   : {ratio:.0f}x fresh tokens — bloat driver "
              + ("HIGH" if p["median"] > 120000 else "ok" if p["median"] <= 60000 else "watch"))
    print("tool bytes (payload that re-enters the conversation):")
    for tool, b in a.get("tool_bytes", {}).items():
        print(f"  {tool:10s} {fmt(b):>8} B")
    print("biggest file reads (bytes re-entering context):")
    for fp, b in a.get("top_file_reads", [])[:8]:
        print(f"  {fmt(b):>8} B  {fp}")
    imgs = a.get("image_attachments", [])
    if imgs:
        print("image attachments — each is ~1.3k-1.6k vision tokens per call "
              "it stays in history (28x28-px tiles), NOT priced by file bytes:")
        for fp, b in imgs:
            print(f"  {fmt(b):>8} B  {fp}")


if __name__ == "__main__":
    main()
