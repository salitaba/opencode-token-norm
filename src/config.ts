import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

/** Cheap reads/greps are how you AVOID waste; do not scare the agent off them. */
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
