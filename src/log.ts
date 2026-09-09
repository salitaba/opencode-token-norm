import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { LOG_PATH } from "./config.js"

export function log(line: string): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* logging must never break a session */
  }
}
