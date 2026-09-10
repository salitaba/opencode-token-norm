#!/usr/bin/env node
// Minimal benchmark harness: plain OpenCode vs OpenCode + token-norm.
//
//   node bench/run.mjs --all --model opencode-go/deepseek-v4-flash \
//        --timeout 240 --max-cost 1.00
//
// Every run gets an isolated HOME/XDG_CONFIG_HOME/XDG_DATA_HOME and workspace
// under /tmp/opencode/tn-bench-runs/. Metrics come from the run's own
// opencode.db via scripts/usage-audit.py, never from the user's real DB.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const benchDir = dirname(fileURLToPath(import.meta.url))
const repo = resolve(benchDir, "..")
const runsRoot = "/tmp/opencode/tn-bench-runs"
const realDataHome = join(homedir(), ".local", "share", "opencode")
const modelsCache = join(homedir(), ".cache", "opencode", "models.json")

function parseArgs(argv) {
  const args = {
    all: false,
    arms: [],
    tasks: [],
    model: "opencode-go/deepseek-v4-flash",
    timeout: 240,
    maxCost: 1.0,
    out: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--all") args.all = true
    else if (a === "--arm") args.arms.push(argv[++i])
    else if (a === "--task") args.tasks.push(argv[++i])
    else if (a === "--model") args.model = argv[++i]
    else if (a === "--timeout") args.timeout = Number(argv[++i])
    else if (a === "--max-cost") args.maxCost = Number(argv[++i])
    else if (a === "--out") args.out = argv[++i]
    else throw new Error(`unknown arg ${a}`)
  }
  if (args.all) args.arms = ["baseline", "treatment"]
  if (args.arms.length === 0) args.arms = ["baseline", "treatment"]
  return args
}

function listTasks() {
  return readdirSync(join(benchDir, "tasks"))
    .filter((n) => existsSync(join(benchDir, "tasks", n, "prompt.txt")))
    .sort()
}

function shell(cmd, argv, opts = {}) {
  return spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts })
}

function runEnv(home, config, data, workspace) {
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    PWD: workspace,
    NO_COLOR: "1",
  }
  delete env.OLDPWD
  for (const key of Object.keys(env)) if (key.startsWith("TOKEN_NORM_")) delete env[key]
  return env
}

function installTreatment(configDir) {
  const plugins = join(configDir, "opencode", "plugins")
  const scripts = join(configDir, "opencode", "scripts")
  mkdirSync(plugins, { recursive: true })
  mkdirSync(scripts, { recursive: true })
  copyFileSync(join(repo, "dist", "plugin.js"), join(plugins, "opencode-token-norm.js"))
  copyFileSync(join(repo, "scripts", "usage-audit.py"), join(scripts, "usage-audit.py"))
}

function countLog(path) {
  const counts = {
    lines: 0,
    announce: 0,
    audit: 0,
    boundary: 0,
    crossing: 0,
    handoffWritten: 0,
    handoffArmed: 0,
  }
  if (!existsSync(path)) return counts
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue
    counts.lines++
    if (line.includes("announce-threshold at")) counts.announce++
    if (line.includes("audit-threshold at")) counts.audit++
    if (line.includes("task-boundary at")) counts.boundary++
    if (line.includes("budget crossing at")) counts.crossing++
    if (line.includes("handoff written to")) counts.handoffWritten++
    if (line.includes("handoff armed")) counts.handoffArmed++
  }
  return counts
}

function sessionIds(env, db) {
  const code =
    "import os,sqlite3;" +
    "c=sqlite3.connect('file:'+os.environ['OPENCODE_DB']+'?mode=ro',uri=True);" +
    "print('\\n'.join(r[0] for r in c.execute('select id from session order by time_created')))"
  const r = shell("python3", ["-c", code], { env: { ...env, OPENCODE_DB: db } })
  if (r.status !== 0) return []
  return r.stdout.split("\n").filter(Boolean)
}

function pct(values, q) {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1)
}

/** Per-tool-call wall latency from tool part timestamps. `exec` is the tool
 * handler itself; `gap` is the interval from the previous tool's end to the
 * next tool's start, i.e. model turn + plugin hook + scheduler. The plugin's
 * own contribution is a subset of `gap`, not the whole of it. */
function toolTimings(db, env) {
  const code =
    "import json,os,sqlite3;" +
    "c=sqlite3.connect('file:'+os.environ['OPENCODE_DB']+'?mode=ro',uri=True);" +
    "q=\"select json_extract(data,'$.state.time.start'), json_extract(data,'$.state.time.end') from part where json_extract(data,'$.type')='tool'\";" +
    "print(json.dumps([[s,e] for s,e in c.execute(q) if s is not None and e is not None]))"
  const r = shell("python3", ["-c", code], { env: { ...env, OPENCODE_DB: db } })
  if (r.status !== 0 || !r.stdout) return { n: 0 }
  let rows
  try {
    rows = JSON.parse(r.stdout)
  } catch {
    return { n: 0 }
  }
  rows.sort((a, b) => a[0] - b[0])
  const exec = []
  const gaps = []
  for (let i = 0; i < rows.length; i++) {
    exec.push(rows[i][1] - rows[i][0])
    if (i > 0) {
      const g = rows[i][0] - rows[i - 1][1]
      if (g >= 0) gaps.push(g)
    }
  }
  return {
    n: rows.length,
    exec_median_ms: pct(exec, 0.5),
    exec_p95_ms: pct(exec, 0.95),
    gap_median_ms: pct(gaps, 0.5),
    gap_p95_ms: pct(gaps, 0.95),
    gap_max_ms: gaps.length ? +Math.max(...gaps).toFixed(1) : null,
  }
}

function collect(db, env) {
  const empty = {
    sessions: 0,
    effective_fresh: 0,
    cost_usd: 0,
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    calls: 0,
    tool_calls: 0,
    context_peak: 0,
    first_call_total: null,
    per_call: null,
  }
  if (!existsSync(db)) return empty
  const ids = sessionIds(env, db)
  if (ids.length === 0) return empty
  const total = { ...empty, sessions: ids.length }
  for (const id of ids) {
    const r = shell("python3", [join(repo, "scripts", "usage-audit.py"), "--session", id, "--json"], {
      env: { ...env, OPENCODE_DB: db },
    })
    if (r.status !== 0 || !r.stdout) continue
    let a
    try {
      a = JSON.parse(r.stdout)
    } catch {
      continue
    }
    const t = a.totals ?? {}
    total.effective_fresh += t.effective_fresh ?? 0
    total.cost_usd += t.cost_usd ?? 0
    total.input += t.input ?? 0
    total.output += t.output ?? 0
    total.cache_read += t.cache_read ?? 0
    total.cache_write += t.cache_write ?? 0
    total.calls += a.calls ?? 0
    total.tool_calls += a.tool_calls ?? 0
    const peak = a.per_call_total?.max ?? 0
    if (peak > total.context_peak) total.context_peak = peak
    if (a.first_call_total != null) {
      total.first_call_total =
        total.first_call_total == null
          ? a.first_call_total
          : Math.min(total.first_call_total, a.first_call_total)
    }
  }
  total.per_call = toolTimings(db, env)
  return total
}

function usd(v) {
  return `$${v.toFixed(4)}`
}

function table(records) {
  const head = ["arm", "task", "ok", "eff.tok", "cost", "wall", "tools", "gap.med", "peak", "handoff", "ann/aud/bnd"]
  const rows = records.map((r) => [
    r.arm,
    r.task,
    r.success ? "yes" : "no",
    String(Math.round(r.metrics.effective_fresh)),
    usd(r.metrics.cost_usd),
    `${(r.wall_ms / 1000).toFixed(1)}s${r.timed_out ? "!" : ""}`,
    String(r.metrics.tool_calls),
    r.metrics.per_call?.gap_median_ms != null ? `${r.metrics.per_call.gap_median_ms}ms` : "-",
    String(r.metrics.context_peak),
    String(r.handoff_notes),
    `${r.log.announce}/${r.log.audit}/${r.log.boundary}`,
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ")
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n")
}

function treeHash(root) {
  const hash = createHash("sha256")
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else hash.update(p.slice(root.length)).update(readFileSync(p))
    }
  }
  walk(root)
  return hash.digest("hex")
}

function runOne({ taskName, arm, args, opencodeVersion, gitHead, stamp, spent }) {
  const taskDir = join(benchDir, "tasks", taskName)
  const prompt = readFileSync(join(taskDir, "prompt.txt"), "utf8").trim()
  const metaPath = join(taskDir, "meta.json")
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {}
  const fixtureBefore = treeHash(join(taskDir, "fixture"))

  const runId = `${stamp}-${arm}-${taskName}`
  const root = join(runsRoot, runId)
  const home = join(root, "home")
  const config = join(root, "config")
  const data = join(root, "data")
  const workspace = join(root, "workspace")
  mkdirSync(join(home, ".cache", "opencode"), { recursive: true })
  mkdirSync(join(config, "opencode"), { recursive: true })
  mkdirSync(join(data, "opencode"), { recursive: true })
  mkdirSync(root, { recursive: true })
  cpSync(join(taskDir, "fixture"), workspace, { recursive: true })

  const auth = join(realDataHome, "auth.json")
  if (!existsSync(auth)) throw new Error(`no auth.json at ${auth}`)
  copyFileSync(auth, join(data, "opencode", "auth.json"))
  if (existsSync(modelsCache)) copyFileSync(modelsCache, join(home, ".cache", "opencode", "models.json"))
  if (arm === "treatment") installTreatment(config)

  const env = runEnv(home, config, data, workspace)
  const started = new Date().toISOString()
  const t0 = Date.now()
  const res = shell(
    "opencode",
    ["run", "--model", args.model, "--auto", "--format", "json", prompt],
    { cwd: workspace, env, timeout: args.timeout * 1000 },
  )
  const wall_ms = Date.now() - t0
  const timed_out = Boolean(res.error && res.error.code === "ETIMEDOUT")

  writeFileSync(join(root, "opencode.stdout.log"), res.stdout ?? "")
  writeFileSync(join(root, "opencode.stderr.log"), res.stderr ?? "")
  const fixtureIntact = treeHash(join(taskDir, "fixture")) === fixtureBefore

  const ev = shell(process.execPath, [join(taskDir, "eval.mjs"), workspace], {
    cwd: taskDir,
    timeout: 60_000,
  })
  const db = join(data, "opencode", "opencode.db")
  const metrics = collect(db, env)
  const handoffDir = join(data, "opencode", "handoff")
  const handoff_notes = existsSync(handoffDir)
    ? readdirSync(handoffDir).filter((f) => f.endsWith(".md")).length
    : 0
  const log = countLog(join(data, "opencode", "token-norm.log"))

  const record = {
    run_id: runId,
    started_at: started,
    arm,
    task: taskName,
    task_class: meta.class ?? null,
    expected_calls: meta.expected_calls ?? null,
    model: args.model,
    git_head: gitHead,
    opencode_version: opencodeVersion,
    timeout_s: args.timeout,
    wall_ms,
    timed_out,
    opencode_status: res.status,
    opencode_signal: res.signal ?? null,
    success: ev.status === 0,
    fixture_intact: fixtureIntact,
    eval_exit: ev.status,
    eval_output: (ev.stdout ?? "").trim().split("\n").slice(0, 5),
    metrics,
    handoff_notes,
    log,
    db_sessions: metrics.sessions,
    run_dir: root,
    cumulative_cost_before: spent,
  }
  return record
}

const args = parseArgs(process.argv.slice(2))
const tasks = args.tasks.length ? args.tasks : listTasks()
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
args.out = args.out ? resolve(args.out) : join(benchDir, "results", `${stamp}.jsonl`)
mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, "")
writeFileSync(
  join(dirname(args.out), `${stamp}.meta.json`),
  JSON.stringify(
    {
      model: args.model,
      arms: args.arms,
      tasks,
      timeout_s: args.timeout,
      max_cost_usd: args.maxCost,
      started_at: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
)

const gitHead = shell("git", ["-C", repo, "rev-parse", "HEAD"]).stdout?.trim()
const opencodeVersion = shell("opencode", ["--version"]).stdout?.trim()

const { appendFileSync } = await import("node:fs")
const recordsCache = []
let spent = 0
let stopped = false
for (const taskName of tasks) {
  for (const arm of args.arms) {
    if (stopped) break
    const record = runOne({ taskName, arm, args, opencodeVersion, gitHead, stamp, spent })
    recordsCache.push(record)
    appendFileSync(args.out, JSON.stringify(record) + "\n")
    spent += record.metrics.cost_usd
    process.stderr.write(
      `[${recordsCache.length}] ${arm}/${taskName} ok=${record.success} ` +
        `eff=${Math.round(record.metrics.effective_fresh)} cost=${usd(record.metrics.cost_usd)} ` +
        `wall=${(record.wall_ms / 1000).toFixed(1)}s tools=${record.metrics.tool_calls}\n`,
    )
    if (spent > args.maxCost) {
      stopped = true
      process.stderr.write(
        `STOP: provider-reported spend ${usd(spent)} exceeded cap ${usd(args.maxCost)}; ` +
          `remaining runs skipped\n`,
      )
    }
  }
}

process.stdout.write(`\nresults: ${args.out}\n`)
process.stdout.write(
  `commit ${gitHead} · opencode ${opencodeVersion} · model ${args.model} · ` +
    `spend ${usd(spent)}\n\n`,
)
process.stdout.write(table(recordsCache) + "\n")
