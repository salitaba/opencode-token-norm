# Tier 1 Deferred Plan — Tool/Phase Weights and JSONL Analytics

Status: proposed 2026-09-12 (recon only; no code). Implements items #4/#5 deferred
by `docs/tier1-plan.md:9,97`. Two independent tasks; one session each.

## Locked decisions (2026-09-12)

- **Phase = `AssistantMessage.mode`** (verified `types.gen.d.ts:110`). Attributed to
  steps through `StepFinishPart.messageID` (`:285`) and to tool calls through the
  session's latest assistant mode (approximate; tool hooks carry no messageID).
- **Weights affect the `MAX_TOOL_CALLS` budget metric only.** Raw `s.calls` keeps
  driving announce/audit/boundary and the policy `calls` axis unchanged.
- **Analytics = plugin-written JSONL, opt-in `TOKEN_NORM_ANALYTICS=1`.** This
  supersedes `docs/design.md:164,183` ("Nothing is persisted") for this one opt-in
  file; default behavior stays non-persistent.
- Cost and effective tokens stay provider-measured; only tool-call accounting is
  weighted, so the ledger is never multiplied.

## Verified attachment points

- Cheap/budgeted binary: `src/config.ts:90-103` (`cheapTools`), `src/budget/plugin.ts:187`,
  `src/budget/state.ts:68`.
- Raw vs budget calls: `SessionState.calls` (`state.ts:12`), `Rollup.calls`
  (`usage.ts:37-43`, rollup `:505-523`, fold `:238-255`), metric `evaluator.ts:71-80`.
- Mode: `message.updated` handler already stores provider/model (`usage.ts:371-380`);
  a bounded messageID→mode map can live beside it. Step sink is `applyStep`
  (`usage.ts:411`); tool sink `noteToolCall` (`:306`).
- Config patterns: `env()`/`num()`/`float()`/`killSwitch()` (`config.ts:26-69`);
  `killSwitch` returns true when absent, so analytics needs an **opt-in** helper
  (`raw === "1"`), not `killSwitch`.
- Reader prior art: `scripts/usage-audit.py --json`; `bench/behavior/analyze.mjs`
  reads `bench/results/*.jsonl` (`docs/evaluation.md:84,108`).

## Task A — tool/phase weights (own session)

1. `config.ts`: `TOKEN_NORM_TOOL_WEIGHTS` / `TOKEN_NORM_PHASE_WEIGHTS`, parsed as
   `name=weight` comma lists (positive numbers, default absent = weight 1).
   Malformed entries reject into the config diagnostics (`config-diagnostics.test.ts`).
2. `state.ts`: add `weightedCalls` to `SessionState`; `track()` keeps raw `calls`
   increment and adds `toolWeight × phaseWeight(latest mode)` to `weightedCalls`.
3. `usage.ts`: store `mode` on `SessionUsage` and a capped messageID→mode map;
   `applyStep` resolves mode via `part.messageID` with session-latest fallback and
   stamps `StepUsage.mode`. `Rollup` gains `weightedCalls` (rollup + fold paths).
4. `evaluator.ts`: `MAX_TOOL_CALLS` compares `rollup.weightedCalls`. Policy/latch
   machinery unchanged; crossing text should say "weighted tool calls".
5. Tests: `test/usage.test.ts` (mode map, weight math, rollup/fold across children),
   `test/session-budget.test.ts` (weighted crossing via existing mock pattern),
   `test/config-diagnostics.test.ts` (bad weight strings).
6. Docs: `docs/configuration.md` new vars; note in `docs/tier1-plan.md` or design.

## Task B — JSONL session analytics (own session)

1. `config.ts`: opt-in `TOKEN_NORM_ANALYTICS` (`1` = on, absent = off, malformed =
   diagnosed + off); `TOKEN_NORM_ANALYTICS_PATH` default
   `${XDG_DATA_HOME:-~/.local/share}/opencode/token-norm-usage.jsonl`; size cap
   `TOKEN_NORM_ANALYTICS_MAX_BYTES` default 50 MiB with single rotate to `.1`.
2. New `src/budget/analytics.ts`: append-only writer (lazy mkdir, createAppendFileSync,
   byte counter, rotate, errors logged once and swallowed). No file paths in records
   by default (privacy); records are `{v:1, ts, type, ...}` with `type` in
   `step | tool | compacted | deleted`.
3. `usage.ts`: optional sink callback set by the plugin; `applyStep` emits a step
   record (sessionID, parentID, mode, cost, effective, tokens, contextAfter),
   `noteToolCall` a tool record (tool, output bytes, weighted). Sink is injectable
   for tests.
4. `src/budget/plugin.ts`: construct the writer once, wire the sink; nothing emitted
   when disabled (zero behavior change).
5. Reader: `scripts/session-analytics.py` (stdlib only, mirrors usage-audit.py style):
   `--jsonl`, `--session`, `--top N`, `--json`; per-session totals, context peak,
   top tools by bytes, cache ratio.
6. Tests: writer/rotation with a tmp dir, sink emission, config opt-in semantics;
   extend `test/usage.test.ts` and `test/config-diagnostics.test.ts`.
7. Docs: `docs/configuration.md`, `docs/design.md` persistence decision, README
   if it lists env vars.

## Order

Task A first (smaller, no new I/O surface), then Task B. Each ends with `npm test`
and its own docs edit; no shared commit.
