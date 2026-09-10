# Benchmark: plain OpenCode vs OpenCode + token-norm

Status: **methodology plus two completed pilots and one fixture revalidation**
(10 paid runs, 2026-09-10, opencode 1.18.30, `deepseek-v4-flash`). Pilot 1
(2 small tasks x 2 arms, commit `79eaf1a`) cost **$0.0071** and never crossed the
announce threshold. Pilot 2 (1 medium + 1 long task x 2 arms, commit `38549cd`)
cost **$0.0289** and triggered all three reminders in the long treatment arm.
The medium fixture was then revised and revalidated for **$0.0099**
(`2026-09-10T23-54-25`). Total pilot spend **$0.0459**. This is a smoke test of
the harness and thresholds, not a study. Do not cite it as evidence that the
plugin reduces cost or tokens.

## Question

On identical tasks, same model, same repo snapshot, does installing the plugin
change effective fresh tokens, provider cost, wall time, tool calls, context
peak, handoff rate, or task success?

## Protocol

- **Snapshot (Pilot 1).** This repo at commit `79eaf1a` (v0.5.3), worktree
  `bench/harness`. Pilot 2 ran from its own snapshot — commit `38549cd` plus the
  uncommitted S1/S2 changes described with its results below. Task fixtures are
  copied fresh per run, so no run sees another run's edits.
- **Model.** `opencode-go/deepseek-v4-flash`, fixed on the command line with
  `--model`. Recorded per run.
- **Isolation.** Every run gets its own `HOME`, `XDG_CONFIG_HOME`,
  `XDG_DATA_HOME`, and workspace under `/tmp/opencode/tn-bench-runs/`. `auth.json`
  and the models cache are copied in; the user's real config and data dirs are
  never touched. Inherited `TOKEN_NORM_*` vars are scrubbed.
- **Arms.**
  - *baseline*: isolated dirs, no plugin.
  - *treatment*: identical dirs plus `dist/plugin.js` copied to
    `$XDG_CONFIG_HOME/opencode/plugins/opencode-token-norm.js` and
    `scripts/usage-audit.py` to `$XDG_CONFIG_HOME/opencode/scripts/`, mirroring
    `scripts/install-local.mjs`. Plugin defaults apply (`TOKEN_NORM_MODE=warn`,
    budget and handoff enabled).
- **Artifact identity.** Every run record and run meta file carries
  `plugin_sha256` and `audit_script_sha256`, the SHA-256 of `dist/plugin.js` and
  `scripts/usage-audit.py` at run time, so a result can be tied to the exact
  bundle and audit script that produced it. Records in `bench/results/` from the
  two pilots predate these fields.
- **Run.** `opencode run --model <id> --auto --format json "<prompt>"` with cwd =
  the task copy. Wall cap 240 s per run by default (`--timeout`), enforced by the
  harness; pilot 1 ran with `--timeout 75`, pilot 2 with 420 s (medium) and
  600 s (long). Runs are sequential, one per arm per task (no repeats, no
  warmup).
- **Tasks.** Fixture dirs under `bench/tasks/<name>/` with `prompt.txt`,
  `fixture/`, and an evaluator `eval.mjs` that lives outside the workspace.
  Evaluator exit 0 = success; it imports the workspace code directly so editing
  the fixture's own check script does not fake a pass.

## Metrics

| Metric | Source |
|---|---|
| Effective fresh tokens | `input + 0.1*cache_read + 1.25*cache_write`, summed over all sessions in the run's DB (`scripts/usage-audit.py`) |
| Total cost (USD) | provider-reported `cost` column, summed over sessions |
| Wall time | harness clock, capped at the run's `--timeout` (240 s default; 75 s pilot 1, 420/600 s pilot 2) |
| Tool calls | count of `tool` parts (`scripts/usage-audit.py`) |
| Context peak | max per-call `total` across sessions |
| Handoff notes | files under the run's `$XDG_DATA_HOME/opencode/handoff/` |
| Plugin firings | line patterns in the run's `$XDG_DATA_HOME/opencode/token-norm.log`: `announce-threshold at`, `audit-threshold at`, `task-boundary at`, `budget crossing at`, `handoff written to` |
| Plugin artifact | SHA-256 of `dist/plugin.js`, recorded per run as `plugin_sha256` |
| Audit script artifact | SHA-256 of `scripts/usage-audit.py`, recorded per run as `audit_script_sha256` |
| Task success | evaluator exit code |

## Cost estimate and caps

`deepseek-v4-flash` list price (models.dev cache): $0.15/M input, $0.60/M output,
$0.003/M cache read. Pilot = 2 tasks x 2 arms = 4 runs; expected well under
$0.10. Harness hard cap defaults to **$1.00** provider-reported spend
(`--max-cost`), then it stops; pilot 1 used `--max-cost 0.25`, pilot 2 used
0.40 (medium) and 0.60 (long). Per-run wall cap defaults to 240 s; pilot 1 used
75 s, pilot 2 used 420 s (medium) and 600 s (long). The full 20-task study is
out of scope and requires explicit approval.

## Pilot 1 results: small tasks (2026-09-10)

Run 2026-09-10 22:49 UTC; raw records in `bench/results/2026-09-10T22-49-51.jsonl`.
Plugin firings column is announce / audit / boundary counts.

| Task | Arm | Success | Effective fresh | Cost | Wall | Tools | Context peak | Handoffs | Plugin firings |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 01-fix-bug | baseline | yes | 10,896 | $0.0015 | 14.4 s | 5 | 9,009 | 0 | 0/0/0 |
| 01-fix-bug | treatment | yes | 11,401 | $0.0015 | 38.4 s | 5 | 9,396 | 0 | 0/0/0 |
| 02-multi-bug | baseline | yes | 13,367 | $0.0021 | 18.9 s | 11 | 10,426 | 0 | 0/0/0 |
| 02-multi-bug | treatment | yes | 13,585 | $0.0020 | 49.4 s | 11 | 10,610 | 0 | 0/0/0 |

All four runs passed; total spend **$0.0071**; no run hit the 75 s wall cap and
every fixture hash was unchanged after runs. What the pilot shows:

- Both tasks stayed far below the plugin's 25-call announce threshold (max 11
  tool calls), so **the plugin never fired** in this pilot. Token, cost, and
  tool-call differences between arms are 0–5%, i.e. noise at N=1 per cell.
- Wall time was ~2.6x longer in the treatment arm on *both* tasks (14.4→38.4 s,
  18.9→49.4 s) with identical tool counts and near-identical tokens. With one
  run per cell this is unexplained; provider latency is as plausible as plugin
  overhead. It is the one signal worth repeating before drawing any conclusion.
- A first harness attempt was discarded: opencode inherited the parent `PWD`
  and edited the original fixtures instead of the per-run copy. The harness now
  sets `PWD` and verifies fixture hashes (`fixture_intact`). That discarded
  attempt did show the announce reminder firing at 26 tool calls in the
  treatment arm, which the pilot tasks are too small to reach.

## Pilot 2 results: medium and long classes (2026-09-10)

Second pilot, run 2026-09-10 23:20–23:31 UTC, to check that the harness
exercises the plugin on the two new task classes and to see where the time
goes. Worktree at commit `38549cd` with the uncommitted S1/S2 changes applied
and `dist/plugin.js` rebuilt. Raw records: `bench/results/pilot-medium.jsonl`
and `bench/results/pilot-long.jsonl`; provider-free latency record:
`bench/results/latency-2026-09-10T23-20-41.json`. Caps: `--max-cost 0.40
--timeout 420` (medium), `--max-cost 0.60 --timeout 600` (long).

| Task class | Task | Arm | Success | Effective fresh | Cost | Wall | Tools | Expected calls | gap.med | exec.med | Context peak | Handoffs | ann/aud/bnd |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| medium | 03-many-bugs | baseline | yes | 26,727 | $0.0062 | 41.0 s | 36 | 25–50 | 397 ms | 19 ms | 18,108 | 0 | 0/0/0 |
| medium | 03-many-bugs | treatment | yes | 38,760 | $0.0048 | 113.6 s | 20 | 25–50 | 4,778 ms | 10 ms | 14,489 | 0 | 0/0/0 |
| long | 04-long-sweep | baseline | yes | 47,736 | $0.0084 | 193.2 s | 60 | 60–150 | 2,596 ms | 8 ms | 23,496 | 0 | 0/0/0 |
| long | 04-long-sweep | treatment | yes | 37,047 | $0.0096 | 98.9 s | 66 | 60–150 | 345 ms | 13 ms | 26,582 | 0 | 1/1/1 |

All four runs passed their evaluator, no run timed out, and all four fixture
hashes were unchanged. Total spend **$0.0289** ($0.0110 medium + $0.0180 long).
The long treatment arm is the first paid run in which the plugin fired, all in
one `opencode run` process: `announce-threshold at 25 calls (read 20, bash 5)`,
`audit-threshold at 60 calls (read 30, edit 25, bash 5)`, and `task-boundary at
65 calls`. Announce and audit are call-count thresholds (25, then every 60);
boundary is not — it fires on the next new user message once the session passed
`BOUNDARY_AT` (`src/config.ts`), so the microbench injected it at call 41 and
this run hit it at 65. No budget crossing and no handoff note was written in
any arm.

### Microbench decomposition

`bench/latency.mjs` replays 130 synthetic tool calls through the real bundled
`dist/plugin.js` hooks with no provider spend, against a no-op baseline; full
record in `latency-2026-09-10T23-20-41.json`:

| Component | Measurement |
|---|---|
| Plugin hook, per call | median **0.004 ms**, p95 0.059 ms |
| Announce injection (call 25) | +650 B, 1.1 ms once |
| Boundary injection (call 41) | +806 B, 0.07 ms once |
| Audit injections (calls 60, 120) | +682/683 B, ~46.2 ms each |
| Audit spawn cost | no-op `python3` median 18.5 ms; full audit median 45.2 ms for ~1,161 B |
| `opencode serve` startup | baseline median 1,193 ms vs treatment 1,224 ms (n=3 each) |

The plugin hook itself is negligible; the only recurring material cost is the
audit's Python spawn (~45 ms) on threshold calls. In the paid runs, `gap.med` is
the interval from one tool's end to the next tool's start — model turn + plugin
hook + scheduler — so the hook is a small subset of what it shows; `exec.med`
is the tool handler itself (≤19 ms in every arm). Neither shows a consistent
arm difference: medium treatment was 12x the baseline gap, long treatment was
0.13x the baseline gap.

### Findings and task-design miss

- **Long class works.** Both arms landed in the 60–150 expected band (60 and 66
  tools) and the treatment crossed all three reminders, so the long fixture
  exercises the plugin in a real run.
- **Medium class missed, then fixed.** In pilot 2, `03-many-bugs` (medium,
  16 modules, expected 25–50) produced only 20 tool calls in the treatment arm —
  below the 25 floor — so no reminder fired, while the baseline arm used 36.
  Thresholds were not changed to hide the miss. The prompt was revised to require
  reading and editing each module individually (no shell batch reads, no
  whole-file rewrites) with an expected band of 30–40 calls, and re-run the same
  day: baseline 39 / treatment 35 calls, both in band, treatment announce fired
  at 25 (table below).
- **No consistent arm signal.** The pilot-1 wall-time gap (treatment ~2.6x
  slower on small tasks) did not replicate: medium treatment was 2.8x slower
  (41.0 → 113.6 s) but long treatment was ~2x faster (193.2 → 98.9 s).
  Effective fresh tokens and cost also flip direction between classes. At N=1
  per cell this is provider/model variance.
- **Handoffs stayed at zero**, including the long treatment run in which the
  boundary reminder fired.

### Medium fixture revalidation (2026-09-10T23-54-25)

Both arms re-run on the revised prompt, commit `bfb2dbe`, with the plugin bundle
and audit script now pinned by their recorded SHA-256s:

| Task class | Task | Arm | Success | Effective fresh | Cost | Wall | Tools | Expected calls | ann/aud/bnd |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| medium | 03-many-bugs | baseline | yes | 25,364 | $0.0055 | 51.6 s | 39 | 30–40 | 0/0/0 |
| medium | 03-many-bugs | treatment | yes | 18,588 | $0.0043 | 106.4 s | 35 | 30–40 | 1/0/0 |

Total spend **$0.0099**. Both arms sit inside the intended band, so the fixture
now exercises the announce threshold in a real run; the treatment crossed it at
25 calls. The behavior instrument
([evaluation.md](evaluation.md#instrumentation-for-behavior)) found no matching
cost statement after that announce in this run. N=1 per arm.

### Limitations (pilot 2)

- In paid runs the plugin's counters live in memory for one `opencode run`
  process, so a task split across multiple invocations would never reach a
  threshold. Both pilot-2 tasks ran as a single invocation; the results
  describe single-session behavior only.
- `gap` includes model latency, so it cannot attribute time to the plugin.
- The startup comparison is n=3 and not statistically meaningful (~30 ms delta
  with overlapping ranges).
- N=1 per arm per class, one model/provider/machine; the medium revalidation
  closes the fixture-size miss, not the sample-size limitation, so those rows
  remain descriptive.

## Caveats (pilot 1)

- N=2 tasks, one run per arm, one model/provider, one snapshot, one machine.
  Results are descriptive only, not causal; run-to-run variance is unmeasured.
  The wall-time gap above is a hypothesis, not a finding.
- The tasks are small and never crossed the plugin's 25-call announce threshold,
  so the arms differ only by plugin load overhead (and model variance) — by
  construction the treatment had almost nothing to do.
- The evaluator scores outcomes, not process quality; a passing run may still be
  wasteful and a clean run may still fail.
- Context peak is per model call. Cache pricing constants in `effective_fresh`
  are Anthropic-like proxies, not this provider's actual billing.
- Provider-reported `cost` is authoritative for spend; treat everything else as
  proxy.
