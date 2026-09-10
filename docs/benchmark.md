# Benchmark: plain OpenCode vs OpenCode + token-norm

Status: **methodology plus a completed 4-run pilot** (2 tasks x 2 arms x 1 run,
2026-09-10, opencode 1.18.30, commit `79eaf1a`, spend **$0.0071** of a $0.25 pilot cap).
It is a smoke test of the harness, not a study. Do not cite it as evidence that
the plugin reduces cost or tokens.

## Question

On identical tasks, same model, same repo snapshot, does installing the plugin
change effective fresh tokens, provider cost, wall time, tool calls, context
peak, handoff rate, or task success?

## Protocol

- **Snapshot.** This repo at commit `79eaf1a` (v0.5.3), worktree `bench/harness`.
  Task fixtures are copied fresh per run, so no run sees another run's edits.
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
- **Run.** `opencode run --model <id> --auto --format json "<prompt>"` with cwd =
  the task copy. Wall cap 240 s per run by default (`--timeout`), enforced by the
  harness; the pilot ran with `--timeout 75`. Runs are sequential, one per arm
  per task (no repeats, no warmup).
- **Tasks.** Fixture dirs under `bench/tasks/<name>/` with `prompt.txt`,
  `fixture/`, and an evaluator `eval.mjs` that lives outside the workspace.
  Evaluator exit 0 = success; it imports the workspace code directly so editing
  the fixture's own check script does not fake a pass.

## Metrics

| Metric | Source |
|---|---|
| Effective fresh tokens | `input + 0.1*cache_read + 1.25*cache_write`, summed over all sessions in the run's DB (`scripts/usage-audit.py`) |
| Total cost (USD) | provider-reported `cost` column, summed over sessions |
| Wall time | harness clock, capped at the run's `--timeout` (240 s default, 75 s in the pilot) |
| Tool calls | count of `tool` parts (`scripts/usage-audit.py`) |
| Context peak | max per-call `total` across sessions |
| Handoff notes | files under the run's `$XDG_DATA_HOME/opencode/handoff/` |
| Plugin firings | line patterns in the run's `$XDG_DATA_HOME/opencode/token-norm.log`: `announce-threshold at`, `audit-threshold at`, `task-boundary at`, `budget crossing at`, `handoff written to` |
| Task success | evaluator exit code |

## Cost estimate and caps

`deepseek-v4-flash` list price (models.dev cache): $0.15/M input, $0.60/M output,
$0.003/M cache read. Pilot = 2 tasks x 2 arms = 4 runs; expected well under
$0.10. Harness hard cap defaults to **$1.00** provider-reported spend
(`--max-cost`), then it stops; the pilot used `--max-cost 0.25`. Per-run wall
cap defaults to 240 s; the pilot used 75 s. The full 20-task study is out of
scope and requires explicit approval.

## Pilot results

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

## Caveats

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
