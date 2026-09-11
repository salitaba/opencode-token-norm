# Benchmark: plain OpenCode vs OpenCode + token-norm

Status: **primary results from the power study** — 1 task x 2 arms x 20 repeats
= 40 paid runs, 2026-09-11, `deepseek-v4-flash`, opencode 1.18.30, **40/40 runs,
0 timeouts, $0.2711** (see [Power study](#power-study-n20-per-arm-2026-09-11)).
It is the only run in this document with enough samples per cell to support a
significance claim, and it **refutes the one candidate hypothesis** the earlier
N=2 variance study produced. On cost, tool calls, effective fresh tokens, and
context peak the arms are statistically indistinguishable. The one apparent
separation — **wall time, +27.4 s per run in the treatment arm (p = 0.018)** —
was subsequently traced to a **benchmark harness artifact, not plugin runtime
cost**: the harness gives every run a fresh `HOME`, so the treatment arm pays a
cold `bun` install cache the first time it loads a plugin. That one window
accounts for a mean **+22.97 s** of the 27.4 s. Subtracting it per run leaves an
**unattributed +4.45 s residual with no significance test** (see
[Wall time is a harness artifact](#wall-time-is-a-harness-artifact)).

The earlier P0 variance study (10 tasks x 2 arms x 2 repeats = 40 paid runs,
commit `b859a99`, **$0.1783**) is kept below as the broader-coverage but
underpowered survey, and the pilots (10 paid runs, 2026-09-10, **$0.0459**) as
setup history. Combined benchmark spend to date is **$0.4953**. Nothing here is
evidence that the plugin reduces cost or tokens.

## Question

On identical tasks, same model, same repo snapshot, does installing the plugin
change effective fresh tokens, provider cost, wall time, tool calls, context
peak, handoff rate, or task success?

## Power study (n=20 per arm, 2026-09-11)

The variance study below ends with one candidate hypothesis: on
`10-string-sweep`, treatment used 66 tool calls in both repeats against 36/37 for
baseline. This study re-ran that single cell at **20 repeats per arm** to find out
whether the gap was real. Raw records: `bench/results/power-string-sweep.jsonl`
and `power-string-sweep.summary.json`. Caps `--max-cost 0.45 --timeout 300`;
**40/40 runs succeeded, 0 timed out, spend $0.2711**, cap not reached.

**The hypothesis does not survive.** Treatment used *fewer* calls on average
(-3.05, p = 0.65), and both arms turn out to be **bimodal** — runs cluster near 35
calls and near 65 calls in each arm, so the original N=2 pair had simply drawn
opposite modes from the two arms. This is the failure mode that repeats exist to
catch, and it is why the cells below are reported with median, standard
deviation, and a bootstrap CI rather than a mean alone.

Per-arm distribution (n=20 each):

| Arm | Metric | Mean | Median | SD | 95% CI (mean) |
|---|---|---:|---:|---:|---|
| baseline | tool calls | 47.25 | 49.5 | 20.44 | 38.40 .. 55.20 |
| treatment | tool calls | 44.20 | 36.0 | 19.48 | 35.55 .. 52.00 |
| baseline | cost (USD) | 0.0066 | 0.0065 | 0.0014 | 0.0058 .. 0.0074 |
| treatment | cost (USD) | 0.0070 | 0.0072 | 0.0016 | 0.0063 .. 0.0077 |
| baseline | eff. fresh | 27,914 | 25,477 | 14,026 | 23,237 .. 34,614 |
| treatment | eff. fresh | 28,911 | 27,960 | 6,473 | 26,402 .. 31,829 |
| baseline | wall (s) | 47.5 | 37.2 | 35.9 | 36.1 .. 66.3 |
| treatment | wall (s) | 74.9 | 59.2 | 36.6 | 60.9 .. 91.7 |

Treatment minus baseline, two-sided permutation test (10,000 resamples):

| Metric | Difference | p |
|---|---:|---:|
| cost_usd | +$0.0004 | 0.51 |
| tool_calls | -3.05 | 0.65 |
| effective_fresh | +997 | 0.83 |
| context_peak | +289 | 0.81 |
| **wall_ms** (raw) | **+27.4 s** | **0.018** |
| wall_ms (adjusted, plugin-load window removed) | +4.45 s | not tested |

- **Four of five metrics are indistinguishable.** Cost, tool calls, effective
  fresh tokens, and context peak all have p > 0.5 — not merely "not significant"
  but centred close to no effect.
- **Wall time is the one raw separation, and it is a harness artifact.**
  Treatment is ~27 s slower per run (47.5 → 74.9 s, p = 0.018). The paired
  per-run decomposition below attributes essentially all of it to the harness,
  not the plugin.
- **Effective-fresh spread is much wider in baseline** (SD 14,026 vs 6,473), so
  the arms differ in variance even where their means agree.
- **Scope.** One task, one model, one provider, one machine, single `opencode
  run` processes, provider-reported cost only. n=20 per arm licenses a claim
  about *this cell*, not about the plugin in general.

### Wall time is a harness artifact

The +27.4 s gap was decomposed after the fact over all 40 runs of
`bench/results/power-string-sweep.jsonl`, using each record's preserved
`run_dir` (`data/opencode/opencode.db` for message and tool timings,
`data/opencode/log/opencode.log` for phase boundaries). No re-run was needed.

Means, baseline → treatment:

| Component | Baseline | Treatment | Diff |
|---|---:|---:|---:|
| wall | 47.5 s | 74.9 s | +27.4 s |
| startup (before first model call) | 1.9 s | 24.7 s | **+22.8 s** |
| session (model + tools) | 45.5 s | 50.1 s | +4.6 s |
| teardown (incl. audit-on-exit) | 0.11 s | 0.11 s | -0.004 s |
| tool exec total | 1.9 s | 1.3 s | -0.6 s |
| assistant calls | 7.9 | 6.7 | -1.2 |
| output tokens | 5,194 | 5,155 | -39 |

The gap is startup, and inside startup it localizes to a single log window: the
interval between the last config `message=loading` line and the next line
(`all LSPs are disabled`) — i.e. plugin loading.

| Arm | Mean | Median | Min | Max |
|---|---:|---:|---:|---:|
| baseline | 0.25 s | 0.24 s | 0.09 s | 0.50 s |
| treatment | 23.22 s | 17.23 s | 13.03 s | 69.91 s |

**Cause: per-run `HOME` isolation, not the plugin.** `bench/run.mjs` builds a
fresh `home/` for every run. Baseline's plugin directory is empty, so opencode
never invokes `bun`; treatment has the plugin installed, so opencode resolves
dependencies against a **cold, empty bun install cache** — treatment run dirs
contain a freshly created `home/.bun/install/cache/`, baseline run dirs have no
`.bun` at all. Both arms already carry the same `package.json`,
`package-lock.json`, and 63 MB `node_modules` in the config dir; only the cache
differs.

Ruled out by direct measurement: transpiling and importing `dist/plugin.js`
(489 KB) costs 0.24 s under `bun` and 0.08 s under `node`; the tool hook is
0.004 ms; the audit subprocess spawn is ~45 ms. All three are orders of
magnitude below 23 s.

**Adjusted effect.** Subtracting each run's plugin-load window:

| | Value |
|---|---:|
| raw wall diff | +27.42 s (p = 0.018, as published) |
| adjusted wall diff | +4.45 s |
| paired positive | 13 of 20 (raw: 17 of 20) |
| baseline wall minus load | mean 47.26 s, median 37.09 s |
| treatment wall minus load | mean 51.72 s, median 39.66 s |

The 4.45 s residual is **unattributed and untested** — no p-value was computed
for it, and it must not be read as a real plugin cost.

**Confirmed in isolation.** Running `bun install` against the same
`package.json`/`package-lock.json` the config dir carries (`@opencode-ai/plugin`
1.18.30, 27 packages) takes **25.66 s** with an empty cache and **0.26 s** with
the real one seeded — a 98x difference that matches the observed window.

**Fixed in the harness.** `bench/run.mjs` now copies the real
`~/.bun/install/cache` into every run's `home/.bun/install/cache`, for *both*
arms, before `opencode` starts. The figures in this section were measured before
that fix; the cell needs a re-run for a clean wall-time number, and until then
the published wall-time figure should be read as measuring the harness.

## Variance study protocol (P0)

- 10 tasks x 2 arms x 2 repeats = 40 runs, `deepseek-v4-flash`, `--timeout 300`.
- Cheapest classes first (small, then medium, then long) so a cap stop still
  leaves usable small/medium cells.
- Isolation as in the pilots: per-run `HOME`/`XDG_*`/workspace under
  `/tmp/opencode/tn-bench-runs/`, fixtures copied fresh per run.
- Artifact identity pinned per run via `plugin_sha256` and
  `audit_script_sha256`.
- Hard cost cap **$0.40** across all paid runs, enforced per invocation below
  that.
- Cells are reported as mean and spread only; two repeats cannot support a
  significance claim, so the study is descriptive and the raw JSONL is the
  evidence.

## Variance study results (2026-09-11)

Run 2026-09-11 ~03:30–05:10 UTC from commit `b859a99` (plugin and audit script
SHAs pinned in every record). Raw records:
`bench/results/variance-small-medium.jsonl` (28 runs, `$0.0942`) and
`bench/results/variance-long.jsonl` (12 runs, `$0.0841`), with matching
`.summary.json` files. Caps: `--max-cost 0.17` per invocation, `--timeout 300`.
**40/40 runs succeeded, 0 timed out, 0 fixtures modified, and neither batch hit
its cap; total spend $0.1783.**

**What this shows.** Over 40 runs the two arms are effectively indistinguishable
on cost and tool calls, and run-to-run spread inside most cells is larger than
the difference between arms. Treatment wall time was longer in 17 of 20 paired
cells despite near-identical call counts — but that direction is largely the
harness's cold bun install cache on plugin load, not the plugin; in the power
study, removing that window drops the count to 13 of 20 (see
[Wall time is a harness artifact](#wall-time-is-a-harness-artifact)). Reminders fired only where expected,
and the behavior instrument found keyword-matched later assistant text after
every fired signal (announce 11/11, audit 3/3, boundary 5/5; handoff never
fired). The one cell that separates consistently — `10-string-sweep`, where
treatment used 66 calls in both repeats vs 36/37 baseline — is a candidate
hypothesis at N=2, not a finding. Read the table below as a variance
measurement, not an efficacy result.

Mean values per cell (N=2 each; `tools` is mean with min..max):

| Task | Class | Arm | Cost | Tools | Eff. fresh | Wall |
|---|---|---|---:|---:|---:|---:|
| 01-fix-bug | small | baseline | $0.0019 | 5.0 (5..5) | 13,604 | 14.4 s |
| 01-fix-bug | small | treatment | $0.0021 | 6.0 (6..6) | 14,760 | 55.5 s |
| 02-multi-bug | small | baseline | $0.0021 | 11.0 (9..13) | 13,018 | 15.6 s |
| 02-multi-bug | small | treatment | $0.0021 | 10.0 (9..11) | 13,303 | 45.1 s |
| 05-string-bug | small | baseline | $0.0016 | 4.0 (4..4) | 10,786 | 16.9 s |
| 05-string-bug | small | treatment | $0.0021 | 4.0 (4..4) | 13,830 | 29.7 s |
| 06-array-bugs | small | baseline | $0.0025 | 7.5 (7..8) | 15,692 | 38.7 s |
| 06-array-bugs | small | treatment | $0.0025 | 9.0 (8..10) | 16,471 | 32.1 s |
| 03-many-bugs | medium | baseline | $0.0048 | 35.0 (35..35) | 18,979 | 151.0 s |
| 03-many-bugs | medium | treatment | $0.0050 | 36.5 (36..37) | 21,560 | 59.3 s |
| 07-twelve-fixes | medium | baseline | $0.0047 | 29.0 (28..30) | 19,217 | 71.7 s |
| 07-twelve-fixes | medium | treatment | $0.0046 | 29.0 (29..29) | 19,438 | 54.7 s |
| 08-eighteen-fixes | medium | baseline | $0.0053 | 41.5 (41..42) | 21,263 | 43.9 s |
| 08-eighteen-fixes | medium | treatment | $0.0058 | 40.5 (40..41) | 24,334 | 64.9 s |
| 04-long-sweep | long | baseline | $0.0055 | 35.0 (35..35) | 21,936 | 57.8 s |
| 04-long-sweep | long | treatment | $0.0041 | 19.5 (4..35) | 20,052 | 91.5 s |
| 09-numeric-sweep | long | baseline | $0.0085 | 65.0 (64..66) | 33,246 | 57.6 s |
| 09-numeric-sweep | long | treatment | $0.0083 | 50.0 (35..65) | 34,908 | 95.3 s |
| 10-string-sweep | long | baseline | $0.0064 | 36.5 (36..37) | 25,545 | 51.0 s |
| 10-string-sweep | long | treatment | $0.0092 | 66.0 (66..66) | 35,695 | 85.9 s |

Descriptive reading (two repeats per cell, one model/machine — not causal):

- **Arm totals are a dead heat.** Baseline: $0.0866 and 539 tool calls over 20
  runs; treatment: $0.0918 and 541 tool calls over 20 runs.
- **Within-cell spread usually exceeds the between-arm difference.**
  `09-numeric-sweep` treatment ranged 35–65 tool calls across two repeats
  (30-call spread); no task/arm mean gap is that large.
- **`10-string-sweep` is the one cell where the arms separate consistently**:
  treatment used 66 calls in both repeats vs 36/37 baseline, and announce/audit/
  boundary all fired in both treatment repeats. With N=2 this is a candidate
  hypothesis (the reminder/audit path may change long-sweep behavior), not a
  finding. **This hypothesis was tested at n=20 per arm and refuted** — the
  difference reverses to -3.05 calls (p = 0.65) and both arms prove bimodal, so
  the N=2 pair had drawn opposite modes. See
  [Power study](#power-study-n20-per-arm-2026-09-11).
- **Treatment wall time is longer in 17 of 20 paired cells** (e.g. small tasks
  14.4→55.5 s, 15.6→45.1 s) despite near-identical call counts. This is now
  explained: the harness gives each run a fresh `HOME`, so only the treatment
  arm pays a cold bun install cache while loading the plugin (mean +22.97 s in
  the power study). Adjusted for that window the count falls to **13 of 20** and
  the residual is small and untested. See
  [Wall time is a harness artifact](#wall-time-is-a-harness-artifact).
- **Reminders fired only where expected**: announce (25 calls) in treatment runs
  of 03/07/08/09/10 and 04 repeat 2; audit and boundary in both 10 repeats and
  in 09 repeat 2; one 04 repeat finished in 4 tool calls (batch fix via shell)
  and saw no reminder. Handoff notes were 0 everywhere.
- **Behavior instrument**: `bench/behavior/analyze.mjs` was run over both
  variance files. In every treatment run where a signal fired, keyword-matched
  assistant text appeared later in the same session — announce 11/11, audit 3/3,
  boundary 5/5. That is `followed`, not `complied`
  ([evaluation.md](evaluation.md#terminology)); baseline runs emit no plugin log.
- **Scope limits**: the study measures single `opencode run` processes, two
  repeats, one model/provider/machine, and provider-reported cost only. It is a
  variance measurement, not an efficacy claim; per-class analysis should pool
  the raw records rather than the rounded table above.

## Harness protocol

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

## Task catalog (2026-09-11)

`bench/tasks/` holds ten fixture tasks. The six added for the P0 variance study
(05–10) are generated and validated offline: `node check.mjs` exits non-zero on
the unsolved fixture and exits 0 against a reference-fixed copy, so a fixture
can be validated without paid runs. Each task has `prompt.txt`, `meta.json`,
`eval.mjs`, and `fixture/`; evaluators import the workspace modules directly.

| Task | Class | Modules | Cases | Expected calls | Notes |
|---|---|---:|---:|---|---|
| 01-fix-bug | small | 1 | 5 | 5–15 | single arithmetic bug |
| 02-multi-bug | small | 3 | 6 | 5–15 | checkout helpers |
| 03-many-bugs | medium | 16 | 39 | 30–40 | per-module read+edit required |
| 04-long-sweep | long | 30 | 67 | 60–150 | crosses announce + audit |
| 05-string-bug | small | 1 | 6 | 5–15 | slugify / truncate |
| 06-array-bugs | small | 2 | 6 | 5–15 | median / rotate |
| 07-twelve-fixes | medium | 12 | 26 | 25–40 | per-module read+edit required |
| 08-eighteen-fixes | medium | 18 | 36 | 35–55 | per-module read+edit required |
| 09-numeric-sweep | long | 30 | 67 | 60–150 | numeric one-liners |
| 10-string-sweep | long | 30 | 64 | 60–150 | string one-liners |

## Batch / repeats mode

`bench/run.mjs` stays single-task by default; `--repeats N` turns it into a
batch that runs N repeats x both arms x the task list (`--all` or repeated
`--task`). One JSONL record per run keeps every existing field and adds
`repeat` and `repeats`; the run id gets an `-rN` suffix when N > 1. An aggregate
`.summary.json` is written next to the JSONL with per task/arm cells: runs,
successes, timed-out count, and mean/min/max/spread for cost, tool calls,
effective fresh tokens, wall time, and context peak.

```bash
node bench/run.mjs --all --repeats 2 --model opencode-go/deepseek-v4-flash \
  --timeout 300 --max-cost 0.40 --out bench/results/variance.jsonl
```

The `--max-cost` guard applies to the whole batch (provider-reported spend,
checked after each run); when it trips the remaining runs are skipped, the
partial summary is still written, and `stopped_early` is set.

## Earlier pilots

These are the harness shakeout runs that preceded the variance study; their
records predate `plugin_sha256`/`audit_script_sha256` and their caps and
timeouts differ from the study above.

Pilot 1 (2 small tasks x 2 arms, commit `79eaf1a`) cost **$0.0071** and never
crossed the announce threshold. Pilot 2 (1 medium + 1 long task x 2 arms, commit
`38549cd`) cost **$0.0289** and triggered all three reminders in the long
treatment arm. The medium fixture was then revised and revalidated for
**$0.0099** (`2026-09-10T23-54-25`). Total pilot spend **$0.0459**.

### Pilot 1 results: small tasks (2026-09-10)

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

### Pilot 2 results: medium and long classes (2026-09-10)

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

#### Findings and task-design miss

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

#### Medium fixture revalidation (2026-09-10T23-54-25)

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

#### Limitations (pilot 2)

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

## Microbench decomposition

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

## Caveats (pilot 1)

- N=2 tasks, one run per arm, one model/provider, one snapshot, one machine.
  Results are descriptive only, not causal; run-to-run variance is unmeasured.
  The wall-time gap above is a harness artifact — per-run `HOME` isolation makes
  the treatment arm pay a cold bun install cache on plugin load. See
  [Wall time is a harness artifact](#wall-time-is-a-harness-artifact).
- The tasks are small and never crossed the plugin's 25-call announce threshold,
  so the arms differ only by plugin load overhead (and model variance) — by
  construction the treatment had almost nothing to do.
- The evaluator scores outcomes, not process quality; a passing run may still be
  wasteful and a clean run may still fail.
- Context peak is per model call. Cache pricing constants in `effective_fresh`
  are Anthropic-like proxies, not this provider's actual billing.
- Provider-reported `cost` is authoritative for spend; treat everything else as
  proxy.
