# Tier 1 Plan — Budgets, Context Pressure, Handoff Recommendations

Status: Tier 1 implemented 2026-09-11 (steps 1-6; 45 tests passing). Step 7
(observe-mode smoke test) ran 2026-09-12 on plugin 0.8.0: live `budget crossing
at 2 calls: context 8.6k/1.0M` from the provider-limit lookup, with `used`
matching that step's `tokens.total` exactly — recorded in docs/compatibility.md.
The at-compaction comparison remains covered by the offline validation in
docs/smoke-test.md §8 (a live run cannot reach compaction cheaply).
Scope: Tier 1 only. Items #4/#5 (tool/phase weights, session analytics) are explicitly deferred — see bottom.

## Goal

Turn behavioral tool-call thresholds into measurable budgets (cost, effective tokens,
context pressure) with enforcement modes, without changing default behavior.

## Verified facts from recon

Repo:
- `src/index.ts` exports `TokenNormBudget` (returns `SessionBudgetPlugin` if `BUDGET_ENABLED`)
  and `TokenNormHandoff` (returns `HandoffPlugin` if `HANDOFF_ENABLED`).
- `src/config.ts` env vars: `TOKEN_NORM_ANNOUNCE_AT=25`, `TOKEN_NORM_AUDIT_EVERY=60`,
  `TOKEN_NORM_BOUNDARY_AT=40`, `TOKEN_NORM_CHEAP_TOOLS=todowrite,question,skill`,
  `TOKEN_NORM_HANDOFF_DIR`, `TOKEN_NORM_LOG`, `TOKEN_NORM_AUDIT_SCRIPT`, `TOKEN_NORM_PYTHON`,
  `TOKEN_NORM_BUDGET`, `TOKEN_NORM_HANDOFF`, `TOKEN_NORM_SETTLE_MS`, `TOKEN_NORM_SWITCH_WAIT_MS`.
- `src/session-budget.ts`: `track()` :41, boundary :125, announce :146, audit :165,
  compaction hook :193 (`experimental.session.compacting`), cleanup on `session.deleted` :80.
  Injection mechanism: append `<system-reminder>` text to `output.output` in `tool.execute.after`.
- `src/handoff.ts`: subagent guard :54 (`client.app.agents()`, `mode === "subagent"`),
  tool :110, session switch :185 (`client.tui.executeCommand({ command: "session_new" })`).
- `scripts/usage-audit.py`: the ONLY place `effective_fresh` exists — :61:
  `input + 0.1*cache_read + 1.25*cache_write`. Reads sqlite `$OPENCODE_DB` (`session`, `part`,
  `message` tables); flags `--last`, `--session`, `--receipt`, `--json`, `--no-color`.
- Tests: vitest, `npm test` (pretest builds plugin via esbuild), files under `test/`,
  mocks `../src/log.js` and `../src/audit.js`.

SDK (`node_modules/@opencode-ai/plugin/dist/index.d.ts`, `@opencode-ai/sdk` generated types):
- `PluginInput` `{ client, project, directory, worktree, experimental_workspace, serverUrl, $ }`
  (plugin/dist/index.d.ts:36-46). `Hooks.event` at :175-177.
- Event union (sdk types.gen.d.ts:602) includes `message.updated`, `message.part.updated`,
  `session.created/updated/deleted/idle/status/compacted`, `todo.updated`, `file.edited`,
  `tui.toast.show`.
- `StepFinishPart` (types.gen.d.ts:282-299): `cost`, `tokens { input, output, reasoning, cache{read,write} }`, `reason`.
- `AssistantMessage` (types.gen.d.ts:98-127): same `cost` + `tokens` shape.
- `Session.parentID` (types.gen.d.ts:469); `client.session.children` (sdk.gen.d.ts:134).
- `client.tui.showToast` (types.gen.d.ts:3264) — usable from a server plugin.
- `Model.limit { context, output }` (types.gen.d.ts:1323-1326);
  `ProviderConfig.models[id].limit.context` (types.gen.d.ts:905-908).
- Hooks `experimental.session.compacting` and `experimental.compaction.autocontinue` exist.

## Verify before writing code (gates, in order)

1. Does `tool.execute.before` exist in `Hooks` and can it block? Check full `Hooks` type in
   `node_modules/@opencode-ai/plugin/dist/index.d.ts`. If it cannot block, cut `block` mode
   (fall back to warn + toast) and document it — do not fake enforcement.
2. Confirm `message.part.updated` carries `sessionID` and `StepFinishPart` arrives once per step;
   pick `StepFinishPart` as the single token/cost source (never also sum `AssistantMessage`).
3. Find the client method that exposes model limits (search sdk client methods); if none,
   require `TOKEN_NORM_CONTEXT_LIMIT` and disable context-ratio warnings otherwise.
4. Validate context formula empirically in `observe` mode against a real `session.compacted` event.

## Implementation steps

1. New `src/usage.ts`:
   - `effectiveFresh(tokens)` mirroring `usage-audit.py:61`.
   - Per-session accumulator: `calls`, `effectiveTokens`, `costUsd`, `contextNow`, `contextPeak`,
     per-step history (tokens/cost/timestamp), `parentID`, `childIDs`.
   - `onEvent`: route `message.part.updated` type `step-finish` into owning session;
     `contextNow = input + cache.read + cache.write + output`; update peak;
     reset `contextNow` on `session.compacted`; delete state on `session.deleted`.
   - Root rollup: root total = own + descendants via `parentID` (`client.session.children`).
2. `src/config.ts`: add `TOKEN_NORM_MODE` (`observe|warn|handoff|block`, default `warn`),
   `TOKEN_NORM_MAX_COST`, `TOKEN_NORM_MAX_EFFECTIVE_TOKENS`, `TOKEN_NORM_MAX_TOOL_CALLS`,
   `TOKEN_NORM_CONTEXT_WARN` (~0.8), `TOKEN_NORM_CONTEXT_LIMIT`. All additive; existing vars untouched.
3. Budget evaluation in `session-budget.ts`: status block (Budget / Effective tokens / Tool calls,
   `used / limit` + %), fired once per crossing per metric, injected through the existing
   `output.output` reminder path. Mode behavior: `observe` logs only (`src/log.ts`);
   `warn` injects (+ optional `tui.showToast`); `handoff` adds skeleton; `block` refuses via
   `tool.execute.before` — opt-in only, never default.
4. Context pressure + attribution (merged item #2): ratio = `contextNow / limit.context`;
   growth = median delta-context per call, flag >2× session median; attribution from tool args/output
   at `tool.execute.after` — bytes per tool, top file reads, repeated-read detection (same
   `filePath` count), images. Every figure labeled "estimated" (bytes ≠ tokens).
5. Handoff recommendation: gate on budget/context pressure AND a pause (`session.idle`, or
   `todo.updated` all-complete). Emit evidence bullets + skeleton with `files` pre-filled from
   `file.edited` events. `done`/`next` stay model-written. Never auto-invokes the handoff tool.
6. Tests: new `test/usage.test.ts` (accumulator math, compaction reset, child rollup, mode
   transitions); extend `test/session-budget.test.ts` using existing mock pattern. Run `npm test`.
7. Observe-mode smoke test (follow `docs/smoke-test.md`); compare computed context vs `session.compacted`.
   Done 2026-09-12 (crossing vs the step's DB `tokens.total`; see `docs/compatibility.md`).

## Locked decisions

- Default mode `warn` = today's behavior. `block` is opt-in; "don't break the user's work" stands.
- Single token/cost source: `StepFinishPart`.
- Attribution always labeled estimated.
- `handoff` mode recommends; it never switches sessions or calls the handoff tool itself.
- Phase/tool-weight budgets (item #4) shipped 2026-09-12: `TOKEN_NORM_TOOL_WEIGHTS` /
  `TOKEN_NORM_PHASE_WEIGHTS` weight the `MAX_TOOL_CALLS` metric only; see
  `docs/configuration.md` and `docs/tier1-deferred-plan.md` Task A. JSONL analytics
  (item #5) remains deferred.
