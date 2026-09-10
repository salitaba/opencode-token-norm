#!/usr/bin/env node
// Behavior analyzer for token-norm benchmark runs: did a fired reminder change
// what the agent said next? Reads a results .jsonl plus each run's
// token-norm.log and read-only opencode.db; emits JSON with per-signal booleans
// and evidence snippets. It measures correlation between a reminder and later
// assistant text, never causation.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const benchDir = dirname(dirname(fileURLToPath(import.meta.url)))
const TEXTY = new Set(["text", "reasoning"])
const DEFAULT_GRACE_MS = 5 * 60 * 1000

export const ANNOUNCE_PATTERNS = [
  ["cost_statement", /\bcost statement\b/i],
  ["remaining_calls", /\bremaining\b[^.\n]{0,80}\bcalls?\b/i],
  ["calls_remaining", /\bcalls?\b[^.\n]{0,40}\b(remaining|left)\b/i],
  ["cap", /\bcaps?\b/i],
  ["cost", /\bcost\b/i],
  ["dollar", /\$\s?\d/],
]

export const AUDIT_PATTERNS = [
  ["effective_fresh", /\beffective[-\s]fresh\b/i],
  ["effective_tokens", /\beffective\b[^.\n]{0,40}\btokens?\b/i],
  ["cache_multiplier", /\bcache\s+multiplier\b/i],
  ["cache_x", /\bcache\b[^.\n]{0,30}\d+(?:\.\d+)?\s*[x×]/i],
  ["x_cache", /\d+(?:\.\d+)?\s*[x×][^.\n]{0,20}\bcache\b/i],
]

export const BOUNDARY_PATTERNS = [
  ["split", /\bsplit\b/i],
  ["handoff", /\bhandoff\b/i],
  ["fresh_session", /\bfresh session\b/i],
  ["new_session", /\bnew session\b/i],
  ["task_boundary", /\btask boundary\b/i],
  ["new_subsystem", /\bnew (?:files?|subsystems?)\b/i],
  ["continuation", /\bcontinuation\b/i],
  ["finish_here", /\b(?:finish|stop|end) here\b/i],
]

const LOG_RE = /^(\S+)\s+(ses_\S+)\s+(.*)$/

export function parseLog(logText) {
  const out = { announce: [], audit: [], boundary: [], handoff: [] }
  for (const line of String(logText ?? "").split("\n")) {
    if (!line.trim()) continue
    const m = line.match(LOG_RE)
    if (!m) continue
    const [, iso, sessionID, rest] = m
    const at = Date.parse(iso)
    if (Number.isNaN(at)) continue
    const calls = (re) => {
      const c = rest.match(re)
      return c ? Number(c[1]) : null
    }
    if (rest.startsWith("announce-threshold at ")) {
      out.announce.push({ at, sessionID, calls: calls(/at (\d+) calls/), raw: line })
    } else if (rest.startsWith("audit-threshold at ")) {
      out.audit.push({ at, sessionID, calls: calls(/at (\d+) calls/), raw: line })
    } else if (rest.startsWith("task-boundary at ")) {
      const msg = rest.match(/\(msg (\S+)\)/)
      out.boundary.push({ at, sessionID, calls: calls(/at (\d+) calls/), msgID: msg?.[1] ?? null, raw: line })
    } else if (rest.startsWith("handoff written to ")) {
      out.handoff.push({ at, sessionID, notePath: rest.slice("handoff written to ".length).trim(), raw: line })
    }
  }
  return out
}

export function snippet(text, n = 240) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function findFollow(parts, { sessionID, at, beforeAt, patterns }) {
  for (const p of parts) {
    if (p.session_id !== sessionID || p.role !== "assistant" || !TEXTY.has(p.part_type)) continue
    if (p.time_created <= at) continue
    if (beforeAt != null && p.time_created >= beforeAt) continue
    const matched = patterns.filter(([, re]) => re.test(p.text ?? "")).map(([name]) => name)
    if (matched.length) return { p, matched }
  }
  return null
}

function coveredEvents(events, patterns, parts) {
  const list = [...events].sort((a, b) => a.at - b.at)
  return list.map((e, i) => {
    const next = list[i + 1]
    const hit = findFollow(parts, { sessionID: e.sessionID, at: e.at, beforeAt: next?.at ?? null, patterns })
    const base = { at: new Date(e.at).toISOString(), calls: e.calls ?? null, msg_id: e.msgID ?? null, raw: e.raw }
    if (!hit) return { ...base, followed: false, matched: [], evidence: null }
    return {
      ...base,
      followed: true,
      matched: hit.matched,
      evidence: {
        message_id: hit.p.message_id,
        part_type: hit.p.part_type,
        delta_ms: hit.p.time_created - e.at,
        snippet: snippet(hit.p.text),
      },
    }
  })
}

function handoffStop(parts, e, graceMs) {
  let last = null
  for (const p of parts) {
    if (p.session_id !== e.sessionID) continue
    if (!last || p.time_created > last.time_created) last = p
  }
  const base = { at: new Date(e.at).toISOString(), note_path: e.notePath, raw: e.raw }
  if (!last) return { ...base, stopped: null, last_activity: null, delta_ms: null, grace_ms: graceMs, evidence: null }
  const delta = last.time_created - e.at
  return {
    ...base,
    stopped: delta <= graceMs,
    last_activity: new Date(last.time_created).toISOString(),
    delta_ms: delta,
    grace_ms: graceMs,
    evidence: TEXTY.has(last.part_type) ? snippet(last.text) : null,
  }
}

export function analyzeBehavior({ logText = "", parts = [], graceMs = DEFAULT_GRACE_MS } = {}) {
  const events = parseLog(logText)
  const ordered = [...parts].sort((a, b) => Number(a.time_created) - Number(b.time_created))
  const announce = coveredEvents(events.announce, ANNOUNCE_PATTERNS, ordered)
  const audit = coveredEvents(events.audit, AUDIT_PATTERNS, ordered)
  const boundary = coveredEvents(events.boundary, BOUNDARY_PATTERNS, ordered)
  const handoff = events.handoff
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((e) => handoffStop(ordered, e, graceMs))
  const stops = handoff.map((e) => e.stopped)
  return {
    signals: {
      announce: { fired: announce.length > 0, followed: announce.some((e) => e.followed), events: announce },
      audit: { fired: audit.length > 0, followed: audit.some((e) => e.followed), events: audit },
      boundary: { fired: boundary.length > 0, followed: boundary.some((e) => e.followed), events: boundary },
      handoff: {
        fired: handoff.length > 0,
        stopped: stops.includes(true) ? true : stops.length > 0 && stops.every((s) => s === null) ? null : false,
        events: handoff,
      },
    },
  }
}

const SQL = `select m.session_id as session_id, p.message_id as message_id,
       p.time_created as time_created, json_extract(p.data,'$.type') as part_type,
       coalesce(json_extract(p.data,'$.text'), '') as text,
       json_extract(m.data,'$.role') as role
from part p join message m on m.id = p.message_id
order by p.time_created`

function shape(rows) {
  return rows.map((r) => ({
    session_id: String(r.session_id),
    message_id: String(r.message_id),
    time_created: Number(r.time_created),
    part_type: String(r.part_type ?? ""),
    text: String(r.text ?? ""),
    role: String(r.role ?? ""),
  }))
}

function loadViaPython(dbPath) {
  const code =
    "import json,sqlite3;" +
    `c=sqlite3.connect('file:'+${JSON.stringify(dbPath)}+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;` +
    `print(json.dumps([dict(r) for r in c.execute(${JSON.stringify(SQL)})]))`
  const res = spawnSync("python3", ["-c", code], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (res.status !== 0) throw new Error(`python3 sqlite read failed: ${(res.stderr ?? "").trim()}`)
  return shape(JSON.parse(res.stdout || "[]"))
}

export async function loadParts(dbPath) {
  if (!dbPath || !existsSync(dbPath)) return { parts: [], source: null, error: "db not found" }
  try {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      return { parts: shape(db.prepare(SQL).all()), source: "node:sqlite", error: null }
    } finally {
      db.close()
    }
  } catch (err) {
    try {
      return { parts: loadViaPython(dbPath), source: "python3", error: null }
    } catch (perr) {
      return { parts: [], source: null, error: String(perr?.message ?? err?.message ?? perr) }
    }
  }
}

function latestResults() {
  const dir = join(benchDir, "results")
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return files[0] ?? null
}

function loadMeta(resultsFile, override) {
  const candidates = []
  if (override) candidates.push(resolve(override))
  candidates.push(resultsFile.replace(/\.jsonl$/, ".meta.json"))
  for (const c of candidates) {
    if (c && existsSync(c)) return { path: c, data: JSON.parse(readFileSync(c, "utf8")) }
  }
  return { path: null, data: null }
}

async function analyzeRecord(record, resultsFile, meta, graceMs) {
  const runDir = record.run_dir ?? null
  const logPath = runDir ? join(runDir, "data", "opencode", "token-norm.log") : null
  const dbPath = runDir ? join(runDir, "data", "opencode", "opencode.db") : null
  const notes = []
  const logText = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : null
  if (logPath && !logText) notes.push("token-norm.log missing; fired flags fall back to the results record and have no event timestamps")
  const { parts, source, error } = await loadParts(dbPath)
  if (error) notes.push(`db unreadable: ${error}`)

  const analysis = analyzeBehavior({ logText: logText ?? "", parts, graceMs })
  const counts = record.log ?? {}
  const infer = {
    announce: Number(counts.announce ?? 0) > 0,
    audit: Number(counts.audit ?? 0) > 0,
    boundary: Number(counts.boundary ?? 0) > 0,
    handoff: Number(counts.handoffWritten ?? 0) > 0,
  }
  for (const key of ["announce", "audit", "boundary"]) {
    if (!analysis.signals[key].fired && infer[key]) analysis.signals[key].fired = true
  }
  if (!analysis.signals.handoff.fired && infer.handoff) {
    analysis.signals.handoff.fired = true
    analysis.signals.handoff.stopped = null
  }
  if (parts.length === 0) {
    for (const key of ["announce", "audit", "boundary"]) analysis.signals[key].followed = null
    analysis.signals.handoff.stopped = null
  }

  return {
    run_id: record.run_id ?? null,
    arm: record.arm ?? null,
    task: record.task ?? null,
    run_dir: runDir,
    artifacts: { results: resultsFile, meta: meta.path, log: logPath, db: dbPath, db_loaded_by: source },
    log_counts: record.log ?? null,
    signals: analysis.signals,
    notes,
  }
}

function summarize(runs) {
  const sum = { runs: runs.length, announce: { fired: 0, followed: 0 }, audit: { fired: 0, followed: 0 }, boundary: { fired: 0, followed: 0 }, handoff: { fired: 0, stopped: 0 } }
  for (const r of runs) {
    for (const key of ["announce", "audit", "boundary"]) {
      if (r.signals[key].fired) sum[key].fired++
      if (r.signals[key].followed === true) sum[key].followed++
    }
    if (r.signals.handoff.fired) sum.handoff.fired++
    if (r.signals.handoff.stopped === true) sum.handoff.stopped++
  }
  return sum
}

export async function analyzeResultsFile(resultsFile, { runId = null, meta: metaOverride = null, graceMs = DEFAULT_GRACE_MS } = {}) {
  const records = readFileSync(resultsFile, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
  const selected = runId ? records.filter((r) => r.run_id === runId) : records
  if (selected.length === 0) throw new Error(`no record${runId ? ` with run_id ${runId}` : ""} in ${resultsFile}`)
  const meta = loadMeta(resultsFile, metaOverride)
  const runs = []
  for (const record of selected) runs.push(await analyzeRecord(record, resultsFile, meta, graceMs))
  return {
    analyzer: "bench/behavior/analyze.mjs",
    schema_version: 1,
    generated_at: new Date().toISOString(),
    results_file: resultsFile,
    meta_file: meta.path,
    meta: meta.data,
    handoff_grace_ms: graceMs,
    summary: summarize(runs),
    runs,
  }
}

function parseArgs(argv) {
  const args = { results: null, runId: null, meta: null, graceMs: DEFAULT_GRACE_MS, out: null }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--run-id") args.runId = argv[++i]
    else if (a === "--meta") args.meta = argv[++i]
    else if (a === "--handoff-grace-ms") args.graceMs = Number(argv[++i])
    else if (a === "--out") args.out = argv[++i]
    else if (a.startsWith("--")) throw new Error(`unknown arg ${a}`)
    else positional.push(a)
  }
  args.results = positional[0] ? resolve(positional[0]) : latestResults()
  if (!args.results) throw new Error(`no results .jsonl found under ${join(benchDir, "results")}`)
  if (!Number.isFinite(args.graceMs) || args.graceMs < 0) throw new Error("--handoff-grace-ms must be >= 0")
  return args
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  const out = await analyzeResultsFile(args.results, { runId: args.runId, meta: args.meta, graceMs: args.graceMs })
  const text = JSON.stringify(out, null, 2)
  if (args.out) writeFileSync(resolve(args.out), `${text}\n`)
  process.stdout.write(`${text}\n`)
}
