import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

const script = fileURLToPath(new URL("../scripts/install-local.mjs", import.meta.url))
const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-norm-install-"))
const env = { ...process.env, XDG_CONFIG_HOME: home }

const plugin = path.join(home, "opencode", "plugins", "opencode-token-norm.js")
const audit = path.join(home, "opencode", "scripts", "usage-audit.py")

describe("install-local CLI", () => {
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }))

  it("installs a self-contained bundle and the audit script", () => {
    const out = execFileSync(process.execPath, [script], { env, encoding: "utf8" })
    expect(out).toContain("installed plugin")

    const source = fs.readFileSync(plugin, "utf8")
    expect(source).toContain("TokenNormBudget")
    expect(source).not.toMatch(/from\s*"@opencode-ai\//)
    expect(fs.existsSync(audit)).toBe(true)
  })

  it("uninstalls both files", () => {
    const out = execFileSync(process.execPath, [script, "uninstall"], { env, encoding: "utf8" })
    expect(out).toContain("removed")
    expect(fs.existsSync(plugin)).toBe(false)
    expect(fs.existsSync(audit)).toBe(false)
  })

  it("rejects an unknown command", () => {
    expect(() =>
      execFileSync(process.execPath, [script, "nonsense"], { env, encoding: "utf8", stdio: "pipe" }),
    ).toThrow()
  })
})
