import { test } from "node:test"
import assert from "node:assert/strict"
import { analyzeBehavior, parseLog } from "./analyze.mjs"

const T0 = Date.parse("2026-01-01T00:00:00.000Z")
const iso = (ms) => new Date(ms).toISOString()
const part = (over) => ({
  session_id: "ses_test",
  message_id: "msg_part",
  time_created: T0,
  part_type: "text",
  text: "",
  role: "assistant",
  ...over,
})

test("parseLog extracts all four event kinds and ignores noise", () => {
  const log = [
    `${iso(T0 + 1000)} ses_test announce-threshold at 25 calls (read 20, bash 5)`,
    `${iso(T0 + 2000)} ses_test audit-threshold at 60 calls (read 30, edit 25, bash 5)`,
    `${iso(T0 + 3000)} ses_test task-boundary at 65 calls (msg msg_user1)`,
    `${iso(T0 + 4000)} ses_test handoff written to /tmp/notes/a note with spaces.md`,
    `${iso(T0 + 4000)} ses_test handoff armed (pause + budget pressure)`,
    "not a log line",
    "",
  ].join("\n")
  const ev = parseLog(log)
  assert.equal(ev.announce.length, 1)
  assert.equal(ev.announce[0].calls, 25)
  assert.equal(ev.announce[0].at, T0 + 1000)
  assert.equal(ev.audit.length, 1)
  assert.equal(ev.audit[0].calls, 60)
  assert.equal(ev.boundary.length, 1)
  assert.equal(ev.boundary[0].msgID, "msg_user1")
  assert.equal(ev.handoff.length, 1)
  assert.equal(ev.handoff[0].notePath, "/tmp/notes/a note with spaces.md")
})

test("every signal present: later assistant messages follow each reminder", () => {
  const log = [
    `${iso(T0 + 1000)} ses_test announce-threshold at 25 calls (read 20, bash 5)`,
    `${iso(T0 + 2000)} ses_test audit-threshold at 60 calls (read 30, edit 25, bash 5)`,
    `${iso(T0 + 3000)} ses_test task-boundary at 65 calls (msg msg_user1)`,
    `${iso(T0 + 4000)} ses_test handoff written to /tmp/notes/note.md`,
  ].join("\n")
  const parts = [
    part({ message_id: "msg_user1", role: "user", time_created: T0, text: "do the thing" }),
    part({
      message_id: "msg_a1",
      time_created: T0 + 1500,
      text: "Cost statement: remaining ~5 tool calls, cap 3 reads, cost so far $0.01.",
    }),
    part({ message_id: "msg_a2", time_created: T0 + 2500, text: "Audit: effective fresh tokens 22k, cache multiplier 1x." }),
    part({ message_id: "msg_a3", time_created: T0 + 3500, text: "No new files or subsystems; propose a fresh session with a handoff." }),
  ]
  const { signals } = analyzeBehavior({ logText: log, parts })
  assert.equal(signals.announce.fired, true)
  assert.equal(signals.announce.followed, true)
  assert.equal(signals.announce.events[0].evidence.message_id, "msg_a1")
  assert.match(signals.announce.events[0].evidence.snippet, /Cost statement/)
  assert.ok(signals.announce.events[0].matched.includes("cost_statement"))
  assert.equal(signals.audit.fired, true)
  assert.equal(signals.audit.followed, true)
  assert.equal(signals.audit.events[0].evidence.message_id, "msg_a2")
  assert.ok(signals.audit.events[0].matched.includes("effective_fresh"))
  assert.equal(signals.boundary.fired, true)
  assert.equal(signals.boundary.followed, true)
  assert.equal(signals.boundary.events[0].msg_id, "msg_user1")
  assert.equal(signals.boundary.events[0].evidence.message_id, "msg_a3")
  assert.equal(signals.handoff.fired, true)
  assert.equal(signals.handoff.stopped, true)
  assert.ok(signals.handoff.events[0].delta_ms < 0)
})

test("reminders fired but no matching assistant text: followed is false", () => {
  const log = `${iso(T0 + 1000)} ses_test announce-threshold at 25 calls (bash 25)`
  const parts = [part({ message_id: "msg_a1", time_created: T0 + 1500, text: "All done." })]
  const { signals } = analyzeBehavior({ logText: log, parts })
  assert.equal(signals.announce.fired, true)
  assert.equal(signals.announce.followed, false)
  assert.equal(signals.announce.events[0].evidence, null)
  assert.equal(signals.audit.fired, false)
  assert.equal(signals.handoff.stopped, false)
})

test("no log events: no signal fires", () => {
  const { signals } = analyzeBehavior({ logText: "hello\n", parts: [part({ text: "cost statement" })] })
  assert.equal(signals.announce.fired, false)
  assert.equal(signals.audit.fired, false)
  assert.equal(signals.boundary.fired, false)
  assert.equal(signals.handoff.fired, false)
})

test("handoff continued past grace: stopped false; missing parts: unmeasured", () => {
  const log = `${iso(T0 + 1000)} ses_test handoff written to /tmp/notes/note.md`
  const continuer = [part({ message_id: "msg_a1", time_created: T0 + 5000, text: "still working" })]
  const cont = analyzeBehavior({ logText: log, parts: continuer, graceMs: 1000 })
  assert.equal(cont.signals.handoff.fired, true)
  assert.equal(cont.signals.handoff.stopped, false)
  assert.equal(cont.signals.handoff.events[0].delta_ms, 4000)

  const unknown = analyzeBehavior({ logText: log, parts: [], graceMs: 1000 })
  assert.equal(unknown.signals.handoff.fired, true)
  assert.equal(unknown.signals.handoff.stopped, null)
  assert.equal(unknown.signals.handoff.events[0].stopped, null)
})

test("matches only inside the event window, not before the threshold", () => {
  const log = [
    `${iso(T0 + 2000)} ses_test audit-threshold at 60 calls (bash 60)`,
    `${iso(T0 + 6000)} ses_test audit-threshold at 120 calls (bash 120)`,
  ].join("\n")
  const parts = [
    part({ message_id: "msg_early", time_created: T0 + 1000, text: "effective tokens 1k" }),
    part({ message_id: "msg_late", time_created: T0 + 7000, text: "effective tokens 2k, cache multiplier 1x" }),
  ]
  const { signals } = analyzeBehavior({ logText: log, parts })
  assert.equal(signals.audit.events.length, 2)
  assert.equal(signals.audit.events[0].followed, false)
  assert.equal(signals.audit.events[1].followed, true)
  assert.equal(signals.audit.events[1].evidence.message_id, "msg_late")
})
