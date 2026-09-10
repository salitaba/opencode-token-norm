import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** `num` cannot read fractions (`0.80` parses to 0 and falls back), and
 * TOKEN_NORM_CONTEXT_WARN is a fraction. */
function float(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

/** A configured budget. Absent, zero, or malformed means "no budget for this
 * metric" rather than a zero budget that blocks all work. */
function optional(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** Norm: ">~30 tool calls" needs an up-front cost statement. Warn slightly
 * early so the announcement can still change the plan instead of narrating it. */
export const ANNOUNCE_AT = num("TOKEN_NORM_ANNOUNCE_AT", 25)

/** Norm: "once midway through long tasks". Then keep reminding, because one
 * notice 120 calls ago is not a live constraint. */
export const AUDIT_EVERY = num("TOKEN_NORM_AUDIT_EVERY", 60)

/** A session that is already large is where a NEW user request should start a
 * fresh session instead of inheriting the old context. Below this, the handoff
 * costs more than it saves. */
export const BOUNDARY_AT = num("TOKEN_NORM_BOUNDARY_AT", 40)

/** Tools that do not count toward the budget. Planning and asking should not
 * burn it; reads and greps do, because context is what you pay for. */
export const CHEAP_TOOLS = new Set(
  (process.env.TOKEN_NORM_CHEAP_TOOLS ?? "todowrite,question,skill")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
)

const DATA_HOME = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")

export const HANDOFF_DIR = process.env.TOKEN_NORM_HANDOFF_DIR || path.join(DATA_HOME, "opencode", "handoff")

export const LOG_PATH = process.env.TOKEN_NORM_LOG || path.join(DATA_HOME, "opencode", "token-norm.log")

/** Resolved relative to the installed package, not to the user's config dir,
 * so the bundled script is found wherever npm/bun placed the package. */
export const AUDIT_SCRIPT =
  process.env.TOKEN_NORM_AUDIT_SCRIPT ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "usage-audit.py")

export const PYTHON = process.env.TOKEN_NORM_PYTHON || "python3"

/** Opt out of one half without uninstalling the package. */
export const BUDGET_ENABLED = process.env.TOKEN_NORM_BUDGET !== "0"
export const HANDOFF_ENABLED = process.env.TOKEN_NORM_HANDOFF !== "0"

/** How hard the budget bites. `warn` is the default and preserves the
 * plugin's historical behavior. `observe` logs crossings but injects nothing
 * (used to validate the context formula against real compactions). `handoff`
 * adds a skeleton at the next pause. `block` refuses non-cheap tool calls and
 * is opt-in only -- "don't break the user's work" still stands. */
export type BudgetMode = "observe" | "warn" | "handoff" | "block"

const MODES = new Set<string>(["observe", "warn", "handoff", "block"])
const RAW_MODE = process.env.TOKEN_NORM_MODE
export const MODE: BudgetMode = RAW_MODE && MODES.has(RAW_MODE) ? (RAW_MODE as BudgetMode) : "warn"

export const MAX_COST = optional("TOKEN_NORM_MAX_COST")
export const MAX_EFFECTIVE_TOKENS = optional("TOKEN_NORM_MAX_EFFECTIVE_TOKENS")
export const MAX_TOOL_CALLS = optional("TOKEN_NORM_MAX_TOOL_CALLS")

/** Fraction of the context window that counts as pressure. */
export const CONTEXT_WARN = float("TOKEN_NORM_CONTEXT_WARN", 0.8, 0, 1)

/** Explicit window size; overrides the model limit resolved from the client. */
export const CONTEXT_LIMIT = optional("TOKEN_NORM_CONTEXT_LIMIT")
