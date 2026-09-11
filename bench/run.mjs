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
  rmSync,
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
// Loading any plugin makes opencode npm-install @opencode-ai/plugin into
// XDG_CONFIG_HOME/opencode. Every run gets a fresh HOME and a fresh config dir,
// so that install runs from scratch: 66 s measured, and it blocks startup only
// on the treatment arm, where it showed up as wall time. Seeding the npm cache
// alone still costs 9 s (npm re-resolves and re-links); seeding the resolved
// node_modules tree costs 1.6 s. So prime the tree once per invocation and
// hardlink it into both arms, keeping them symmetric and neither paying it.
const depsCache = join(runsRoot, ".plugin-deps")
const depsEntries = ["node_modules", "package.json", "package-lock.json"]

function parseArgs(argv) {
  const args = {
    all: false,
    arms: [],
    tasks: [],
    model: "opencode-go/deepseek-v4-flash",
    timeout: 240,
    maxCost: 1.0,
    repeats: 1,
    out: null,
    resummarize: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--all") args.all = true
    else if (a === "--arm") args.arms.push(argv[++i])
    else if (a === "--task") args.tasks.push(argv[++i])
    else if (a === "--model") args.model = argv[++i]
    else if (a === "--timeout") args.timeout = Number(argv[++i])
    else if (a === "--max-cost") args.maxCost = Number(argv[++i])
    else if (a === "--repeats") args.repeats = Math.max(1, Math.floor(Number(argv[++i])) || 1)
    else if (a === "--resummarize") args.resummarize = argv[++i]
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

// Resolve @opencode-ai/plugin once, in a throwaway config dir, by running the
// cheapest opencode subcommand that loads plugins. Result is reused by every
// run in this invocation. Returns false if priming did not produce a tree, in
// which case runs fall back to paying the install themselves.
function primeDeps() {
  if (depsEntries.every((e) => existsSync(join(depsCache, e)))) return true
  const tmp = join(runsRoot, ".plugin-deps-prime")
  rmSync(tmp, { recursive: true, force: true })
  const home = join(tmp, "home")
  const config = join(tmp, "config")
  const data = join(tmp, "data")
  const workspace = join(tmp, "workspace")
  for (const d of [home, join(config, "opencode"), join(data, "opencode"), workspace]) {
    mkdirSync(d, { recursive: true })
  }
  installTreatment(config)
  const res = shell("opencode", ["debug", "config"], {
    cwd: workspace,
    env: runEnv(home, config, data, workspace),
    timeout: 300_000,
  })
  const primed = join(config, "opencode")
  const ok = depsEntries.every((e) => existsSync(join(primed, e)))
  if (!ok) {
    process.stderr.write(`warn: plugin dep priming failed (status ${res.status}); runs pay install\n`)
    return false
  }
  rmSync(depsCache, { recursive: true, force: true })
  mkdirSync(depsCache, { recursive: true })
  for (const e of depsEntries) cpSync(join(primed, e), join(depsCache, e), { recursive: true })
  rmSync(tmp, { recursive: true, force: true })
  return true
}

// Hardlink the primed tree in (0.05 s vs 3.8 s for a real copy); npm only reads
// it, and each run's config dir is discarded afterwards.
function seedDeps(configDir) {
  const dst = join(configDir, "opencode")
  for (const e of depsEntries) {
    const src = join(depsCache, e)
    if (!existsSync(src)) continue
    const r = shell("cp", ["-al", src, join(dst, e)])
    if (r.status !== 0) cpSync(src, join(dst, e), { recursive: true })
  }
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

function fileHash(path) {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null
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

function runOne({ taskName, arm, repeat, args, opencodeVersion, gitHead, stamp, spent }) {
  const taskDir = join(benchDir, "tasks", taskName)
  const prompt = readFileSync(join(taskDir, "prompt.txt"), "utf8").trim()
  const metaPath = join(taskDir, "meta.json")
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {}
  const fixtureBefore = treeHash(join(taskDir, "fixture"))
  const pluginSha256 = fileHash(join(repo, "dist", "plugin.js"))
  const auditScriptSha256 = fileHash(join(repo, "scripts", "usage-audit.py"))

  const runId = `${stamp}-${arm}-${taskName}${args.repeats > 1 ? `-r${repeat}` : ""}`
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
  seedDeps(config)
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
    repeat,
    repeats: args.repeats,
    task_class: meta.class ?? null,
    expected_calls: meta.expected_calls ?? null,
    model: args.model,
    git_head: gitHead,
    plugin_sha256: pluginSha256,
    audit_script_sha256: auditScriptSha256,
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
let tasks = args.tasks.length ? args.tasks : listTasks()
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)

/** Recompute the summary from an existing JSONL with no paid runs. Used to add
 * statistics to records that were already collected, and to verify changes to
 * the aggregation against real data. Never spawns opencode and never writes to
 * the input file. */
const resummarizePath = args.resummarize ? resolve(args.resummarize) : null
if (resummarizePath) {
  if (!existsSync(resummarizePath)) throw new Error(`no such records file: ${resummarizePath}`)
  args.out = resummarizePath
}

args.out = args.out ? resolve(args.out) : join(benchDir, "results", `${stamp}.jsonl`)
const pluginSha256 = resummarizePath ? null : fileHash(join(repo, "dist", "plugin.js"))
const auditScriptSha256 = resummarizePath ? null : fileHash(join(repo, "scripts", "usage-audit.py"))
if (!resummarizePath) {
mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, "")
writeFileSync(
  join(dirname(args.out), `${stamp}.meta.json`),
  JSON.stringify(
    {
      model: args.model,
      arms: args.arms,
      tasks,
      plugin_sha256: pluginSha256,
      audit_script_sha256: auditScriptSha256,
      timeout_s: args.timeout,
      max_cost_usd: args.maxCost,
      repeats: args.repeats,
      started_at: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
)
}

const gitHead = resummarizePath ? null : shell("git", ["-C", repo, "rev-parse", "HEAD"]).stdout?.trim()
const opencodeVersion = resummarizePath ? null : shell("opencode", ["--version"]).stdout?.trim()

const { appendFileSync } = await import("node:fs")
const recordsCache = []
let spent = 0
let stopped = false

if (resummarizePath) {
  for (const line of readFileSync(resummarizePath, "utf8").split("\n")) {
    if (line.trim()) recordsCache.push(JSON.parse(line))
  }
  // Derive the grid from the records so the summary covers exactly what ran,
  // not whatever the default task list happens to be today.
  tasks = [...new Set(recordsCache.map((r) => r.task))].sort()
  args.arms = [...new Set(recordsCache.map((r) => r.arm))].sort()
  args.repeats = Math.max(1, ...recordsCache.map((r) => r.repeat ?? 1))
  spent = recordsCache.reduce((a, r) => a + (r.metrics?.cost_usd ?? 0), 0)
}

let planned = tasks.length * args.arms.length * args.repeats
if (resummarizePath) planned = recordsCache.length

if (!resummarizePath) primeDeps()

run: for (let repeat = 1; resummarizePath ? false : repeat <= args.repeats; repeat++) {
  for (const taskName of tasks) {
    for (const arm of args.arms) {
      if (stopped) break run
      const record = runOne({
        taskName,
        arm,
        repeat,
        args,
        opencodeVersion,
        gitHead,
        stamp,
        spent,
      })
      recordsCache.push(record)
      appendFileSync(args.out, JSON.stringify(record) + "\n")
      spent += record.metrics.cost_usd
      process.stderr.write(
        `[${recordsCache.length}/${planned}] r${repeat} ${arm}/${taskName} ok=${record.success} ` +
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
}

/** Deterministic RNG so resampling below is reproducible from the same records. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length

function median(values) {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Sample standard deviation (n-1). Null below two observations, where spread
 * is undefined rather than zero. */
function stdev(values) {
  if (values.length < 2) return null
  const m = mean(values)
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1))
}

const BOOTSTRAP_RESAMPLES = 2000

/** Percentile bootstrap CI for the mean. Distribution-free, which matters
 * because tool-call counts are discrete and visibly non-normal. */
function bootstrapMeanCI(values, rand) {
  if (values.length < 2) return null
  const means = []
  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
    let sum = 0
    for (let j = 0; j < values.length; j++) sum += values[Math.floor(rand() * values.length)]
    means.push(sum / values.length)
  }
  means.sort((a, b) => a - b)
  const at = (q) => means[Math.min(means.length - 1, Math.floor(q * means.length))]
  return { lo: +at(0.025).toFixed(6), hi: +at(0.975).toFixed(6) }
}

function cellStats(values, rand) {
  if (values.length === 0) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const sd = stdev(values)
  const ci = rand ? bootstrapMeanCI(values, rand) : null
  return {
    n: values.length,
    mean: +mean(values).toFixed(6),
    median: +median(values).toFixed(6),
    sd: sd === null ? null : +sd.toFixed(6),
    min: +min.toFixed(6),
    max: +max.toFixed(6),
    spread: +(max - min).toFixed(6),
    ci95_lo: ci ? ci.lo : null,
    ci95_hi: ci ? ci.hi : null,
  }
}

const PERMUTATIONS = 10000

/** Two-sided permutation test on the difference of means. Exchangeability under
 * the null is the only assumption; with n around 20 per arm this is more
 * defensible than a t-test on discrete, skewed counts. */
function permutationTest(a, b, rand) {
  if (a.length < 2 || b.length < 2) return null
  const observed = mean(b) - mean(a)
  const pool = [...a, ...b]
  let extreme = 0
  for (let i = 0; i < PERMUTATIONS; i++) {
    const shuffled = [...pool]
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1))
      ;[shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]]
    }
    const diff = mean(shuffled.slice(a.length)) - mean(shuffled.slice(0, a.length))
    if (Math.abs(diff) >= Math.abs(observed) - 1e-12) extreme++
  }
  // Add-one correction: p is never reported as exactly 0 from finite resampling.
  return {
    diff: +observed.toFixed(6),
    p_value: +((extreme + 1) / (PERMUTATIONS + 1)).toFixed(4),
    resamples: PERMUTATIONS,
  }
}

const CONTRAST_METRICS = {
  cost_usd: (r) => r.metrics.cost_usd,
  tool_calls: (r) => r.metrics.tool_calls,
  effective_fresh: (r) => r.metrics.effective_fresh,
  wall_ms: (r) => r.wall_ms,
  context_peak: (r) => r.metrics.context_peak,
}

/** Per-task treatment-vs-baseline contrast. Only emitted when both arms ran,
 * and flagged underpowered below five runs per arm so a small batch cannot be
 * read as a result. */
function contrasts(records, rand) {
  const out = []
  if (!args.arms.includes("baseline") || !args.arms.includes("treatment")) return out
  for (const task of tasks) {
    const base = records.filter((r) => r.task === task && r.arm === "baseline")
    const treat = records.filter((r) => r.task === task && r.arm === "treatment")
    if (base.length === 0 || treat.length === 0) continue
    const metrics = {}
    for (const [name, pick] of Object.entries(CONTRAST_METRICS)) {
      metrics[name] = permutationTest(base.map(pick), treat.map(pick), rand)
    }
    out.push({
      task,
      task_class: (base[0] ?? treat[0]).task_class,
      n_baseline: base.length,
      n_treatment: treat.length,
      underpowered: base.length < 5 || treat.length < 5,
      metrics,
    })
  }
  return out
}

function summarize(records, totalSpend) {
  // Fixed seed: the same records always yield the same CIs and p-values.
  const rand = mulberry32(0x7a5c_0de)
  const cells = []
  for (const task of tasks) {
    for (const arm of args.arms) {
      const rs = records.filter((r) => r.task === task && r.arm === arm)
      if (rs.length === 0) continue
      cells.push({
        task,
        arm,
        task_class: rs[0].task_class,
        runs: rs.length,
        successes: rs.filter((r) => r.success).length,
        timed_out: rs.filter((r) => r.timed_out).length,
        cost_usd: cellStats(rs.map((r) => r.metrics.cost_usd), rand),
        tool_calls: cellStats(rs.map((r) => r.metrics.tool_calls), rand),
        effective_fresh: cellStats(rs.map((r) => r.metrics.effective_fresh), rand),
        wall_ms: cellStats(rs.map((r) => r.wall_ms), rand),
        context_peak: cellStats(rs.map((r) => r.metrics.context_peak), rand),
        handoff_notes: rs.reduce((a, r) => a + r.handoff_notes, 0),
      })
    }
  }
  return {
    model: args.model,
    repeats: args.repeats,
    arms: args.arms,
    tasks,
    planned_runs: planned,
    completed_runs: records.length,
    stopped_early: stopped,
    spend_usd: +totalSpend.toFixed(6),
    max_cost_usd: args.maxCost,
    cells,
    contrasts: contrasts(records, rand),
  }
}

function contrastTable(rows) {
  if (rows.length === 0) return ""
  const head = ["task", "n(b/t)", "tools.diff", "tools.p", "cost.diff", "cost.p", "eff.diff", "eff.p"]
  const cell = (t) => (t ? [t.diff, t.p_value] : ["-", "-"])
  const body = rows.map((r) => {
    const [td, tp] = cell(r.metrics.tool_calls)
    const [cd, cp] = cell(r.metrics.cost_usd)
    const [ed, ep] = cell(r.metrics.effective_fresh)
    return [
      r.task + (r.underpowered ? " *" : ""),
      `${r.n_baseline}/${r.n_treatment}`,
      typeof td === "number" ? td.toFixed(1) : td,
      String(tp),
      typeof cd === "number" ? usd(cd) : cd,
      String(cp),
      typeof ed === "number" ? String(Math.round(ed)) : ed,
      String(ep),
    ]
  })
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)))
  const line = (row) => row.map((c, i) => c.padEnd(widths[i])).join("  ")
  const note = rows.some((r) => r.underpowered)
    ? "\n* underpowered (<5 runs per arm): descriptive only, do not read the p-value as a result."
    : ""
  return (
    "\ntreatment - baseline (permutation test, two-sided):\n" +
    [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n") +
    note +
    "\n"
  )
}

function summaryTable(cells) {
  const head = [
    "task",
    "arm",
    "runs",
    "ok",
    "cost.mean",
    "cost.min..max",
    "tools.mean",
    "tools.min..max",
    "eff.mean",
    "wall.mean",
    "tools.sd",
  ]
  const rows = cells.map((c) => [
    c.task,
    c.arm,
    String(c.runs),
    String(c.successes),
    usd(c.cost_usd.mean),
    `${usd(c.cost_usd.min)}..${usd(c.cost_usd.max)}`,
    c.tool_calls.mean.toFixed(1),
    `${c.tool_calls.min}..${c.tool_calls.max}`,
    String(Math.round(c.effective_fresh.mean)),
    `${(c.wall_ms.mean / 1000).toFixed(1)}s`,
    c.tool_calls.sd === null ? "-" : c.tool_calls.sd.toFixed(1),
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
  const line = (cellsRow) => cellsRow.map((c, i) => c.padEnd(widths[i])).join("  ")
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n")
}

const summary = summarize(recordsCache, spent)
const summaryPath = args.out.endsWith(".jsonl")
  ? args.out.slice(0, -".jsonl".length) + ".summary.json"
  : args.out + ".summary.json"
writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n")

process.stdout.write(`\nresults: ${args.out}\n`)
process.stdout.write(`summary: ${summaryPath}\n`)
process.stdout.write(
  `commit ${gitHead} · opencode ${opencodeVersion} · model ${args.model} · ` +
    `spend ${usd(spent)} · runs ${recordsCache.length}/${planned}` +
    `${stopped ? " (stopped early)" : ""}\n\n`,
)
process.stdout.write("summary by task/arm:\n" + summaryTable(summary.cells) + "\n")
process.stdout.write(contrastTable(summary.contrasts) + "\n")
process.stdout.write("individual runs:\n" + table(recordsCache) + "\n")
