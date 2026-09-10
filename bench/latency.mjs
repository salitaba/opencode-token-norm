#!/usr/bin/env node
// Provider-free latency microbench for the token-norm plugin hooks.
//
// The end-to-end harness can only show a wall-time gap between arms; it cannot
// say where the time went. This bench decomposes it without a provider:
//
//   1. per-tool-call hook CPU  -- drives the real bundled dist/plugin.js
//      `tool.execute.after` and `event` handlers with synthetic payloads for
//      N calls, crossing ANNOUNCE_AT (25), BOUNDARY_AT (40) and AUDIT_EVERY
//      (60/120), and times each call against a no-op baseline;
//   2. the python audit spawn -- times scripts/usage-audit.py against a COPY
//      of a real opencode.db, plus a bare `python3 -c pass` startup floor;
//   3. server startup -- `opencode serve` time-to-listen with and without the
//      plugin installed.
//
// No provider calls, no model variance. What it does NOT cover: opencode's own
// event-loop scheduling, TUI interaction (absent in `opencode run`), or model
// latency. Compare only against itself, not against the pilot's wall times.
//
//   node bench/latency.mjs [--calls 130] [--skip-startup] [--out <path>]
import { spawn, spawnSync, execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import net from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const benchDir = dirname(fileURLToPath(import.meta.url))
const repo = resolve(benchDir, "..")
const runsRoot = "/tmp/opencode/tn-bench-runs"
const realDataHome = join(homedir(), ".local", "share", "opencode")

function parseArgs(argv) {
  const args = { calls: 130, startup: true, out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--calls") args.calls = Number(argv[++i])
    else if (a === "--skip-startup") args.startup = false
    else if (a === "--out") args.out = argv[++i]
    else if (a === "--help" || a === "-h") {
      process.stdout.write("usage: node bench/latency.mjs [--calls 130] [--skip-startup] [--out path]\n")
      process.exit(0)
    } else throw new Error(`unknown arg ${a}`)
  }
  return args
}

/** Newest valid opencode.db under the bench runs, else the user's real one,
 * backed up with sqlite's backup API so WAL state comes along. Never opens the
 * source in write mode. Returns { db, session, src }. */
function prepareDb(tmp) {
  const dst = join(tmp, "opencode.db")
  const code = `import os, sqlite3, sys
runs_root, real, dst = sys.argv[1], sys.argv[2], sys.argv[3]
cands = []
if os.path.isdir(runs_root):
    for name in os.listdir(runs_root):
        p = os.path.join(runs_root, name, "data", "opencode", "opencode.db")
        if os.path.exists(p):
            cands.append((os.path.getmtime(p), p))
if not cands and os.path.exists(real):
    cands.append((os.path.getmtime(real), real))
for _, src in sorted(cands, reverse=True):
    try:
        c = sqlite3.connect("file:" + src + "?mode=ro", uri=True)
        if not c.execute("select name from sqlite_master where type='table' and name='session'").fetchone():
            c.close()
            continue
        row = c.execute("select id from session order by time_updated desc limit 1").fetchone()
        d = sqlite3.connect(dst)
        c.backup(d)
        d.close()
        c.close()
        print(src)
        print(row[0] if row else "")
        break
    except Exception:
        continue`
  const r = spawnSync("python3", ["-c", code, runsRoot, join(realDataHome, "opencode.db"), dst], { encoding: "utf8" })
  const [src, session] = (r.stdout ?? "").trim().split("\n")
  if (r.status !== 0 || !src) return { db: join(tmp, "missing.db"), session: "ses_bench_synthetic", src: null }
  if (!session) return { db: dst, session: "ses_bench_synthetic", src }
  return { db: dst, session, src }
}

function stats(values) {
  if (values.length === 0) return { n: 0 }
  const s = [...values].sort((a, b) => a - b)
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return {
    n: s.length,
    min: +s[0].toFixed(3),
    median: +at(0.5).toFixed(3),
    p95: +at(0.95).toFixed(3),
    max: +s[s.length - 1].toFixed(3),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
  }
}

function countLog(path) {
  const counts = { announce: 0, audit: 0, boundary: 0 }
  if (!existsSync(path)) return counts
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.includes("announce-threshold at")) counts.announce++
    if (line.includes("audit-threshold at")) counts.audit++
    if (line.includes("task-boundary at")) counts.boundary++
  }
  return counts
}

function cleanEnv(extra) {
  const env = { ...process.env, ...extra }
  for (const key of Object.keys(env)) if (key.startsWith("TOKEN_NORM_")) delete env[key]
  return env
}

async function driveHooks({ calls, sessionID, logPath, plugins }) {
  const noop = async () => {}
  const baseline = []
  const treatment = []
  const injections = []
  const client = {
    tui: { showToast: async () => ({}) },
    config: { providers: async () => ({ data: { providers: [] } }) },
  }
  const hooks = await plugins.TokenNormBudget({ client })
  const toolNames = ["read", "edit", "bash", "grep"]
  let armed = false
  for (let i = 1; i <= calls; i++) {
    const input = { sessionID, tool: toolNames[i % toolNames.length], args: { filePath: `src/f${i}.ts` } }
    const base = "x".repeat(200)

    let t = performance.now()
    await noop()
    baseline.push(performance.now() - t)

    const output = { output: base }
    t = performance.now()
    await hooks["tool.execute.after"](input, output)
    treatment.push(performance.now() - t)
    if (output.output.length > base.length) {
      const label = i === ANNOUNCE_CALL ? "announce" : i === BOUNDARY_CALL + 1 ? "boundary" : i % AUDIT_EVERY === 0 ? "audit" : "unknown"
      injections.push({ call: i, ms: +treatment[treatment.length - 1].toFixed(3), added_bytes: output.output.length - base.length, label })
    }

    // A new user message in an already-large session arms the boundary
    // reminder; the NEXT tool call must carry it. One event, one injection.
    if (i === BOUNDARY_CALL && !armed) {
      armed = true
      await hooks.event({
        event: { type: "message.updated", properties: { info: { role: "user", sessionID, id: "msg_bench_boundary" } } },
      })
    }
  }
  return {
    hooks,
    baseline: stats(baseline),
    treatment: stats(treatment),
    overhead: {
      median: +stats(treatment.map((v, i) => v - baseline[i])).median.toFixed(3),
      p95: +stats(treatment.map((v, i) => v - baseline[i])).p95.toFixed(3),
    },
    injections,
    log: countLog(logPath),
  }
}

const ANNOUNCE_CALL = 25
const BOUNDARY_CALL = 40
const AUDIT_EVERY = 60

function timeAudit({ db, session, script, python }) {
  const env = { ...process.env, OPENCODE_DB: db }
  const noopRun = () => {
    const t = performance.now()
    execFileSync(python, ["-c", "pass"], { stdio: "ignore" })
    return performance.now() - t
  }
  const auditRun = () => {
    const t = performance.now()
    const out = execFileSync(python, [script, "--session", session], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env,
      maxBuffer: 1024 * 1024,
    })
    return { ms: performance.now() - t, bytes: Buffer.byteLength(out) }
  }
  noopRun()
  auditRun()
  const pythonMs = []
  for (let i = 0; i < 5; i++) pythonMs.push(noopRun())
  const auditMs = []
  let bytes = 0
  for (let i = 0; i < 5; i++) {
    const r = auditRun()
    auditMs.push(r.ms)
    bytes = r.bytes
  }
  return { python_noop_ms: stats(pythonMs), audit_ms: stats(auditMs), audit_bytes: bytes }
}

function installTreatment(config) {
  const plugins = join(config, "opencode", "plugins")
  const scripts = join(config, "opencode", "scripts")
  mkdirSync(plugins, { recursive: true })
  mkdirSync(scripts, { recursive: true })
  copyFileSync(join(repo, "dist", "plugin.js"), join(plugins, "opencode-token-norm.js"))
  copyFileSync(join(repo, "scripts", "usage-audit.py"), join(scripts, "usage-audit.py"))
}

function waitForPort(port, deadline) {
  return new Promise((resolveWait) => {
    const attempt = () => {
      const sock = net.connect({ host: "127.0.0.1", port })
      sock.once("connect", () => {
        sock.destroy()
        resolveWait(true)
      })
      sock.once("error", () => {
        sock.destroy()
        if (performance.now() > deadline) resolveWait(false)
        else setTimeout(attempt, 30)
      })
    }
    attempt()
  })
}

async function timeServe(arm, root, port) {
  const home = join(root, arm, "home")
  const config = join(root, arm, "config")
  const data = join(root, arm, "data")
  const workspace = join(root, arm, "workspace")
  for (const d of [join(home, ".cache", "opencode"), join(config, "opencode"), join(data, "opencode"), workspace]) {
    mkdirSync(d, { recursive: true })
  }
  const auth = join(realDataHome, "auth.json")
  if (existsSync(auth)) copyFileSync(auth, join(data, "opencode", "auth.json"))
  const models = join(homedir(), ".cache", "opencode", "models.json")
  if (existsSync(models)) copyFileSync(models, join(home, ".cache", "opencode", "models.json"))
  if (arm === "treatment") installTreatment(config)
  const env = cleanEnv({
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    PWD: workspace,
    NO_COLOR: "1",
  })
  delete env.OLDPWD
  delete env.OPENCODE_DB

  const t0 = performance.now()
  const child = spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: workspace,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  })
  let exited = false
  let stderr = ""
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 400) stderr += String(chunk)
  })
  child.once("exit", () => {
    exited = true
  })
  const ready = await waitForPort(port, t0 + 15_000)
  const exitedBefore = exited
  const ms = ready ? performance.now() - t0 : null
  try {
    child.kill("SIGTERM")
  } catch {
    /* already gone */
  }
  await new Promise((r) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        /* already gone */
      }
      r()
    }, 2000)
    child.once("exit", () => {
      clearTimeout(timer)
      r()
    })
  })
  if (!ready && exitedBefore) return { ms: null, note: `server exited before listening: ${stderr.trim().slice(0, 300)}` }
  if (!ready) return { ms: null, note: "no listen within 15s" }
  return { ms: +ms.toFixed(1) }
}

async function measureStartup(root) {
  const results = { baseline: [], treatment: [] }
  let port = 34100 + Math.floor(Math.random() * 2000)
  for (const arm of ["baseline", "treatment"]) {
    await timeServe(arm, root, port++) // warmup, discarded
  }
  for (let rep = 0; rep < 3; rep++) {
    for (const arm of ["baseline", "treatment"]) {
      const r = await timeServe(arm, root, port++)
      results[arm].push(r)
    }
  }
  return {
    baseline_ms: stats(results.baseline.filter((r) => r.ms != null).map((r) => r.ms)),
    treatment_ms: stats(results.treatment.filter((r) => r.ms != null).map((r) => r.ms)),
    raw: results,
  }
}

const args = parseArgs(process.argv.slice(2))
if (!existsSync(join(repo, "dist", "plugin.js"))) {
  throw new Error("dist/plugin.js missing -- run `npm run build:plugin` first")
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const tmp = join("/tmp/opencode", `tn-latency-${stamp}`)
mkdirSync(tmp, { recursive: true })

const { db, session, src } = prepareDb(tmp)
const logPath = join(tmp, "token-norm.log")
process.env.XDG_DATA_HOME = join(tmp, "data")
process.env.TOKEN_NORM_LOG = logPath
process.env.OPENCODE_DB = db
for (const key of Object.keys(process.env)) {
  if (key.startsWith("TOKEN_NORM_") && key !== "TOKEN_NORM_LOG") delete process.env[key]
}

const plugins = await import(pathToFileURL(join(repo, "dist", "plugin.js")).href)
const hook = await driveHooks({ calls: args.calls, sessionID: session, logPath, plugins })

const script = join(repo, "scripts", "usage-audit.py")
const python = process.env.TOKEN_NORM_PYTHON || "python3"
const audit = timeAudit({ db, session, script, python })

const out = {
  generated_at: new Date().toISOString(),
  repo,
  calls: args.calls,
  session_id: session,
  db_source: src ? (src === join(realDataHome, "opencode.db") ? "copied real user db" : "copied bench run db") : "missing (audit error path)",
  baseline_per_call_ms: hook.baseline,
  hook_per_call_ms: hook.treatment,
  hook_overhead_ms: hook.overhead,
  injections: hook.injections,
  log_firings: hook.log,
  audit_spawn: {
    ...audit,
    plugin_audit_call_ms: hook.injections.filter((i) => i.label === "audit").map((i) => i.ms),
  },
  startup: null,
}
if (args.startup) out.startup = await measureStartup(join(tmp, "serve"))

const outPath = args.out ? resolve(args.out) : join(benchDir, "results", `latency-${stamp}.json`)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n")

const fmt = (s) => (s.n ? `med ${s.median}ms p95 ${s.p95}ms max ${s.max}ms (n=${s.n})` : "n/a")
process.stdout.write(`\nlatency microbench -- ${args.calls} synthetic tool calls, python audit against ${out.db_source}\n`)
process.stdout.write(`  baseline loop/call : ${fmt(out.baseline_per_call_ms)}\n`)
process.stdout.write(`  plugin hook/call   : ${fmt(out.hook_per_call_ms)}  overhead med ${out.hook_overhead_ms.median}ms p95 ${out.hook_overhead_ms.p95}ms\n`)
process.stdout.write(`  injections         : ${out.injections.map((i) => `#${i.call}:${i.label} ${i.ms}ms`).join(", ") || "none"}\n`)
process.stdout.write(`  log firings        : ${JSON.stringify(out.log_firings)}\n`)
process.stdout.write(`  python noop spawn  : ${fmt(out.audit_spawn.python_noop_ms)}\n`)
process.stdout.write(`  audit spawn        : ${fmt(out.audit_spawn.audit_ms)} (${out.audit_spawn.audit_bytes} bytes out)\n`)
if (out.startup) {
  process.stdout.write(`  serve startup      : baseline ${fmt(out.startup.baseline_ms)} | treatment ${fmt(out.startup.treatment_ms)}\n`)
} else {
  process.stdout.write("  serve startup      : skipped\n")
}
process.stdout.write(`\nresults: ${outPath}\n`)
