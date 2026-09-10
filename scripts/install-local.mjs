#!/usr/bin/env node
// One-command installer for the opencode-token-norm OpenCode plugin.
//
// Why it installs a local plugin file instead of the npm-spec `plugin` entry:
// OpenCode builds >= 1.17 can silently never initialize npm-spec plugins (no
// error, no log, no tool; upstream anomalyco/opencode#48379). The identical code
// loaded from a local plugin file works. So the published package ships a
// self-contained bundle (all dependencies inlined) and this command copies it
// into the global plugin directory.
//
//   npx opencode-token-norm            install / update
//   npx opencode-token-norm uninstall  remove
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const bundle = join(pkgRoot, "dist", "plugin.js")
const auditScript = join(pkgRoot, "scripts", "usage-audit.py")
const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
const opencodeDir = join(configHome, "opencode")
const pluginTarget = join(opencodeDir, "plugins", "opencode-token-norm.js")
const auditTarget = join(opencodeDir, "scripts", "usage-audit.py")

const command = (process.argv[2] ?? "install").replace(/^--/, "")

function configStillListsPlugin() {
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const file = join(opencodeDir, name)
    if (!existsSync(file)) continue
    try {
      if (/"plugin"\s*:\s*\[[^\]]*"opencode-token-norm"/.test(readFileSync(file, "utf8"))) return name
    } catch {
      /* unreadable config is not this command's problem */
    }
  }
  return null
}

function install() {
  if (!existsSync(bundle)) {
    console.error(`no build found at ${bundle}\nrun \`npm run build:plugin\` first, or install from npm`)
    process.exit(1)
  }
  mkdirSync(dirname(pluginTarget), { recursive: true })
  mkdirSync(dirname(auditTarget), { recursive: true })
  copyFileSync(bundle, pluginTarget)
  copyFileSync(auditScript, auditTarget)

  console.log(`installed plugin  -> ${pluginTarget}`)
  console.log(`installed audit   -> ${auditTarget}`)
  console.log("")
  console.log("Restart OpenCode to load it. Verify it with the smoke test:")
  console.log("  https://github.com/salitaba/opencode-token-norm/blob/main/docs/smoke-test.md")
  const listed = configStillListsPlugin()
  if (listed) {
    console.log("")
    console.log(`note: ${listed} still lists "opencode-token-norm" under "plugin".`)
    console.log("Remove that entry so a future fixed OpenCode does not load it twice.")
  }
}

function uninstall() {
  let removed = false
  for (const file of [pluginTarget, auditTarget]) {
    if (existsSync(file)) {
      rmSync(file)
      console.log(`removed ${file}`)
      removed = true
    }
  }
  if (!removed) console.log("nothing to remove")
}

function help() {
  console.log("usage: opencode-token-norm [install|uninstall]\n")
  console.log("  install    copy the plugin into ~/.config/opencode/plugins (default)")
  console.log("  uninstall  remove it")
}

if (command === "install") install()
else if (command === "uninstall" || command === "remove") uninstall()
else if (command === "help") help()
else {
  help()
  process.exit(1)
}
