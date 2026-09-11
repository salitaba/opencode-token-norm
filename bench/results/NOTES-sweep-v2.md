# power-string-sweep-v2 — state / done / next

## Done

- `opencode` 1.18.30 installs `@opencode-ai/plugin` with **npm**, not bun
  (config dir has `package-lock.json`, no `bun.lock`; `home/.npm/_cacache` is
  written inside the plugin-load window). Commit 4a97b59's bun-cache seeding was
  reading the wrong tool and never took effect.
- Fixed in 6e0b101 (pushed): `bench/run.mjs` primes the resolved dep tree once
  per invocation into `/tmp/opencode/tn-bench-runs/.plugin-deps`, then hardlinks
  `node_modules` + `package.json` + `package-lock.json` into every run's config
  dir, **both arms**, before `opencode` starts.
- Measured with `opencode debug config` (loads plugins, exits, zero API cost):
  fresh 66.7 s / npm-cache-seeded 9.2 s / tree-seeded 1.6 s / warm 1.5 s.
- Verified in the live sweep: baseline r1 plugin-load window **0.113 s**
  (`20:03:09.665` → `20:03:09.778`), against 23.22 s broken and 98.7 s after the
  bun attempt. Baseline reference range is 0.1–0.5 s.
- `docs/benchmark.md` and `CHANGELOG.md` amended to match; the false "cold bun
  cache" claims are gone. `node --check` clean, `tsc --noEmit` exit 0.

## State

Sweep launched detached, PID 1939341, started 2026-09-11T20:03 local:

```
node bench/run.mjs --task 10-string-sweep --repeats 20 \
  --model opencode-go/deepseek-v4-flash --timeout 300 --max-cost 0.45 \
  --out bench/results/power-string-sweep-v2.jsonl
```

Console log at `/tmp/opencode/sweep-v2.log`. Budget $0.45. Records append one
JSON object per line, so partial results are usable if it dies.

Revised from observed rate: 2 runs took 5:02, i.e. ~2.5 min/run, so **~100 min
total** and ~$0.31 — not the ~40 min first estimated. First pair:

```
[1/40] r1 baseline   ok=true eff=33713 cost=$0.0081 wall=188.4s tools=65
[2/40] r1 treatment  ok=true eff=35530 cost=$0.0074 wall=98.2s  tools=36
```

Treatment wall time is *below* baseline in that pair, which is the expected
direction once the install stops landing on treatment — but n=1 and the tool
counts differ 65 vs 36, so that gap is task behavior, not startup. Wait for all
40 before reading anything into it.

## Next

1. Confirm it finished: `tail -20 /tmp/opencode/sweep-v2.log`, and
   `wc -l bench/results/power-string-sweep-v2.jsonl` should be 40.
2. Check the window across all runs, not just r1 — this is the whole point of
   the re-run. For each record's preserved `run_dir`:
   `grep -nE 'message=loading|all LSPs' <run_dir>/data/opencode/log/opencode.log | tail -6`
   The gap between the LAST `message=loading` and `all LSPs are disabled` is the
   metric. Every run in both arms should now be <1 s. `/tmp/opencode/decomp.py`
   and `decomp2.py` do this in bulk but are pointed at the v1 results file.
3. Only once that holds: update `docs/benchmark.md` with the clean wall-time
   figure. The `wall_ms` row in the permutation table, the headline at line 10,
   and the pilot-1 caveat all still carry the harness-contaminated number and
   are currently flagged as such.

## Do not

- Re-derive the localization of the gap to the plugin-load window. Settled
  across two sessions, 40 runs, paired per-run decomposition.
- Re-measure the plugin's own costs: tool hook 0.004 ms, audit subprocess spawn
  ~45 ms, importing `dist/plugin.js` 0.24 s bun / 0.08 s node. None explain
  seconds.
- Sleep-poll the sweep. A prior session burned ~40 tool calls doing that.
