import { beforeEach, describe, expect, it } from "vitest"
import { state, track } from "../src/budget/state.js"
import { UsageTracker, type StepTokens } from "../src/usage.js"

const ROOT = "ses_root"
const CHEAP = new Set(["todowrite", "question", "skill"])
const TOOLS = ["read", "bash", "edit", "todowrite", "question", "skill"]
const EPSILON = 1e-9

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rnd: () => number, list: T[]): T {
  return list[Math.floor(rnd() * list.length)] as T
}

let partSeq = 0

function randomTokens(rnd: () => number): StepTokens {
  return {
    input: Math.floor(rnd() * 1000),
    output: Math.floor(rnd() * 500),
    reasoning: 0,
    cache: { read: Math.floor(rnd() * 500), write: Math.floor(rnd() * 100) },
  }
}

function tokens(input = 0): StepTokens {
  return { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function step(tracker: UsageTracker, sessionID: string, t: StepTokens, cost: number): void {
  tracker.handleEvent({
    type: "message.part.updated",
    properties: { part: { id: `part_${partSeq++}`, sessionID, type: "step-finish", cost, tokens: t } },
  })
}

interface EntrySnapshot {
  cost: number
  effective: number
  steps: number
  calls: number
}

function entrySnapshot(tracker: UsageTracker, id: string): EntrySnapshot {
  const s = tracker.get(id)
  return { cost: s.costUsd, effective: s.effectiveTokens, steps: s.stepCount, calls: s.calls }
}

function ledgerTotal(tracker: UsageTracker, ids: string[]): { cost: number; effective: number } {
  let cost = 0
  let effective = 0
  for (const id of ids) {
    if (!tracker.has(id)) continue
    const s = tracker.get(id)
    cost += s.costUsd + (s.folded?.costUsd ?? 0)
    effective += s.effectiveTokens + (s.folded?.effectiveTokens ?? 0)
  }
  return { cost, effective }
}

beforeEach(() => {
  state.clear()
})

describe("usage ledger invariants (seeded randomized replay)", () => {
  it("never decreases per-session counters or the conserved ledger total", () => {
    const tracker = new UsageTracker()
    const rnd = mulberry32(0x5eed0001)
    const created = [ROOT]
    const live = [ROOT]
    const snapshots = new Map<string, EntrySnapshot>()
    tracker.handleEvent({ type: "session.created", properties: { info: { id: ROOT } } })
    snapshots.set(ROOT, entrySnapshot(tracker, ROOT))
    let total = ledgerTotal(tracker, created)
    const failures: string[] = []

    for (let i = 0; i < 700; i++) {
      const roll = rnd()
      if (roll < 0.28) {
        const id = `ses_${created.length}`
        const parent = pick(rnd, live)
        created.push(id)
        live.push(id)
        tracker.handleEvent({ type: "session.created", properties: { info: { id, parentID: parent } } })
        snapshots.set(id, entrySnapshot(tracker, id))
      } else if (roll < 0.62) {
        const id = pick(rnd, live)
        step(tracker, id, randomTokens(rnd), rnd() * 0.5)
        tracker.noteToolCall(id, pick(rnd, TOOLS), {}, { output: "x".repeat(1 + Math.floor(rnd() * 30)) }, rnd() < 0.7)
      } else if (roll < 0.72) {
        tracker.handleEvent({ type: "session.compacted", properties: { sessionID: pick(rnd, live) } })
      } else if (roll < 0.78) {
        const id = pick(rnd, live)
        tracker.handleEvent({
          type: "message.updated",
          properties: { info: { role: "assistant", sessionID: id, providerID: "p", modelID: "m" } },
        })
      } else if (roll < 0.86) {
        const movable = live.filter((id) => id !== ROOT)
        if (movable.length > 0) {
          const id = pick(rnd, movable)
          tracker.handleEvent({ type: "session.updated", properties: { info: { id, parentID: ROOT } } })
        }
      } else if (live.length > 1) {
        const id = pick(rnd, live.filter((x) => x !== ROOT))
        const before = ledgerTotal(tracker, created)
        tracker.handleEvent({ type: "session.deleted", properties: { info: { id } } })
        live.splice(live.indexOf(id), 1)
        snapshots.delete(id)

        step(tracker, id, randomTokens(rnd), 5)
        tracker.noteToolCall(id, "read", { filePath: "/tmp/zombie" }, { output: "zzz" }, true)
        tracker.handleEvent({ type: "session.updated", properties: { info: { id, parentID: ROOT } } })

        if (tracker.has(id)) failures.push(`deleted ${id} was resurrected`)
        const after = ledgerTotal(tracker, created)
        if (after.cost < before.cost - EPSILON || after.effective < before.effective - EPSILON) {
          failures.push(`delete of ${id} lost ledger value: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
        }
      }

      for (const id of live) {
        if (!tracker.has(id)) continue
        const now = entrySnapshot(tracker, id)
        const prev = snapshots.get(id)
        if (
          prev &&
          (now.cost < prev.cost - EPSILON ||
            now.effective < prev.effective - EPSILON ||
            now.steps < prev.steps ||
            now.calls < prev.calls)
        ) {
          failures.push(`${id} decreased: ${JSON.stringify(prev)} -> ${JSON.stringify(now)}`)
        }
        snapshots.set(id, now)
      }

      const nowTotal = ledgerTotal(tracker, created)
      if (nowTotal.cost < total.cost - EPSILON || nowTotal.effective < total.effective - EPSILON) {
        failures.push(`ledger total decreased at event ${i}: ${JSON.stringify(total)} -> ${JSON.stringify(nowTotal)}`)
      }
      total = nowTotal
    }

    expect(failures).toEqual([])
    expect(created.length).toBeGreaterThan(50)
  })

  it("never decreases the root rollup while the root lives", () => {
    const tracker = new UsageTracker()
    const rnd = mulberry32(0x5eed0002)
    const created = [ROOT]
    const live = [ROOT]
    tracker.handleEvent({ type: "session.created", properties: { info: { id: ROOT } } })
    let prev = tracker.rollup(ROOT)
    const failures: string[] = []

    for (let i = 0; i < 500; i++) {
      const roll = rnd()
      if (roll < 0.3) {
        const id = `roll_${created.length}`
        const parent = pick(rnd, live)
        created.push(id)
        live.push(id)
        tracker.handleEvent({ type: "session.created", properties: { info: { id, parentID: parent } } })
      } else if (roll < 0.75) {
        const id = pick(rnd, live)
        step(tracker, id, randomTokens(rnd), rnd() * 0.4)
        tracker.noteToolCall(id, pick(rnd, TOOLS), {}, { output: "y".repeat(1 + Math.floor(rnd() * 20)) }, rnd() < 0.6)
      } else if (roll < 0.85) {
        tracker.handleEvent({ type: "session.compacted", properties: { sessionID: pick(rnd, live) } })
      } else if (live.length > 1) {
        const id = pick(rnd, live.filter((x) => x !== ROOT))
        tracker.handleEvent({ type: "session.deleted", properties: { info: { id } } })
        live.splice(live.indexOf(id), 1)
      }

      const now = tracker.rollup(ROOT)
      if (
        now.costUsd < prev.costUsd - EPSILON ||
        now.effectiveTokens < prev.effectiveTokens - EPSILON ||
        now.stepCount < prev.stepCount ||
        now.calls < prev.calls ||
        now.sessions < prev.sessions
      ) {
        failures.push(`rollup decreased at event ${i}: ${JSON.stringify(prev)} -> ${JSON.stringify(now)}`)
      }
      prev = now
    }

    expect(failures).toEqual([])
    expect(live.length).toBeGreaterThan(20)
  })
})

describe("deletion semantics", () => {
  it("folds a deleted session into its parent and reparents children to the surviving ancestor", () => {
    const tracker = new UsageTracker()
    tracker.handleEvent({ type: "session.created", properties: { info: { id: "ses_mid", parentID: ROOT } } })
    tracker.handleEvent({ type: "session.created", properties: { info: { id: "ses_leaf", parentID: "ses_mid" } } })
    step(tracker, "ses_mid", tokens(400), 0.4)
    step(tracker, "ses_leaf", tokens(200), 0.25)
    tracker.noteToolCall("ses_mid", "read", {}, { output: "xxxx" }, true)
    const before = tracker.rollup(ROOT)

    tracker.handleEvent({ type: "session.deleted", properties: { info: { id: "ses_mid" } } })

    expect(tracker.has("ses_mid")).toBe(false)
    expect(tracker.get("ses_leaf").parentID).toBe(ROOT)
    expect(tracker.get(ROOT).childIDs.has("ses_mid")).toBe(false)
    expect(tracker.get(ROOT).childIDs.has("ses_leaf")).toBe(true)
    expect(tracker.rootOf("ses_leaf")).toBe(ROOT)

    const after = tracker.rollup(ROOT)
    expect(after.sessions).toBe(before.sessions)
    expect(after.costUsd).toBeCloseTo(before.costUsd, 10)
    expect(after.effectiveTokens).toBeCloseTo(before.effectiveTokens, 10)
    expect(after.stepCount).toBe(before.stepCount)
    expect(after.calls).toBe(before.calls)
  })

  it("ignores late events addressed to a deleted id and does not resurrect it", () => {
    const tracker = new UsageTracker()
    tracker.handleEvent({ type: "session.created", properties: { info: { id: "ses_gone", parentID: ROOT } } })
    step(tracker, "ses_gone", tokens(100), 0.3)
    tracker.noteToolCall("ses_gone", "read", {}, { output: "abc" }, true)
    tracker.handleEvent({ type: "session.deleted", properties: { info: { id: "ses_gone" } } })
    const after = tracker.rollup(ROOT)

    step(tracker, "ses_gone", tokens(9999), 9)
    tracker.noteToolCall("ses_gone", "read", { filePath: "/tmp/z" }, { output: "zzzz" }, true)
    tracker.handleEvent({
      type: "message.updated",
      properties: { info: { role: "assistant", sessionID: "ses_gone", providerID: "p", modelID: "m" } },
    })
    tracker.handleEvent({ type: "session.updated", properties: { info: { id: "ses_gone", parentID: ROOT } } })

    expect(tracker.has("ses_gone")).toBe(false)
    const later = tracker.rollup(ROOT)
    expect(later.costUsd).toBeCloseTo(after.costUsd, 10)
    expect(later.effectiveTokens).toBeCloseTo(after.effectiveTokens, 10)
    expect(later.calls).toBe(after.calls)
    expect(later.stepCount).toBe(after.stepCount)
  })

  it("only a genuine session.created restarts a deleted id, adding to the folded past", () => {
    const tracker = new UsageTracker()
    tracker.handleEvent({ type: "session.created", properties: { info: { id: "ses_again", parentID: ROOT } } })
    step(tracker, "ses_again", tokens(1000), 0.5)
    tracker.handleEvent({ type: "session.deleted", properties: { info: { id: "ses_again" } } })

    tracker.handleEvent({ type: "session.created", properties: { info: { id: "ses_again", parentID: ROOT } } })
    step(tracker, "ses_again", tokens(100), 0.1)

    expect(tracker.has("ses_again")).toBe(true)
    expect(tracker.get("ses_again").costUsd).toBeCloseTo(0.1, 10)
    const rollup = tracker.rollup(ROOT)
    expect(rollup.costUsd).toBeCloseTo(0.6, 10)
    expect(rollup.sessions).toBe(3)
  })

  it("keeps suppressing an id evicted from the recent-deleted window", () => {
    const tracker = new UsageTracker()
    tracker.handleEvent({ type: "session.created", properties: { info: { id: "ses_evicted", parentID: ROOT } } })
    step(tracker, "ses_evicted", tokens(100), 0.5)
    tracker.handleEvent({ type: "session.deleted", properties: { info: { id: "ses_evicted" } } })
    const folded = tracker.rollup(ROOT)
    expect(folded.costUsd).toBeCloseTo(0.5, 10)
    expect(tracker.has("ses_evicted")).toBe(false)

    // More deletions than the recent-deleted window, so `ses_evicted` leaves
    // the exact set while its spend stays folded into ROOT.
    for (let i = 0; i < 550; i++) {
      const id = `ses_churn_${i}`
      tracker.handleEvent({ type: "session.created", properties: { info: { id, parentID: ROOT } } })
      tracker.handleEvent({ type: "session.deleted", properties: { info: { id } } })
    }

    step(tracker, "ses_evicted", tokens(9999), 9)
    tracker.noteToolCall("ses_evicted", "read", { filePath: "/tmp/zombie" }, { output: "zzzz" }, true)
    tracker.handleEvent({
      type: "message.updated",
      properties: { info: { role: "assistant", sessionID: "ses_evicted", providerID: "p", modelID: "m" } },
    })
    tracker.handleEvent({ type: "session.updated", properties: { info: { id: "ses_evicted", parentID: ROOT } } })

    expect(tracker.has("ses_evicted")).toBe(false)
    const after = tracker.rollup(ROOT)
    expect(after.costUsd).toBeCloseTo(folded.costUsd, 10)
    expect(after.stepCount).toBe(folded.stepCount)
    expect(after.calls).toBe(folded.calls)
    expect(after.sessions).toBe(folded.sessions + 550)
  })

  it("a deleted root has no parent, so its own totals leave the live ledger", () => {
    const tracker = new UsageTracker()
    tracker.handleEvent({ type: "session.created", properties: { info: { id: "ses_orphan", parentID: ROOT } } })
    step(tracker, ROOT, tokens(500), 0.7)
    step(tracker, "ses_orphan", tokens(100), 0.2)

    tracker.handleEvent({ type: "session.deleted", properties: { info: { id: ROOT } } })

    expect(tracker.has(ROOT)).toBe(false)
    expect(tracker.get("ses_orphan").parentID).toBeUndefined()
    expect(tracker.rootOf("ses_orphan")).toBe("ses_orphan")
    expect(tracker.rollup(ROOT).costUsd).toBe(0)
    expect(tracker.rollup(ROOT).sessions).toBe(0)
    expect(tracker.rollup("ses_orphan").costUsd).toBeCloseTo(0.2, 10)
  })
})

describe("SessionState call counters (seeded randomized tracking)", () => {
  it("counts non-cheap calls exactly and never decreases per session", () => {
    const rnd = mulberry32(0x5eed0003)
    const ids = ["ses_a", "ses_b", "ses_c"]
    const expected = new Map(ids.map((id) => [id, 0]))
    const snapshots = new Map<string, number>()

    for (let i = 0; i < 600; i++) {
      const id = pick(rnd, ids)
      const tool = pick(rnd, TOOLS)
      const s = track(id, tool)
      if (!CHEAP.has(tool)) expected.set(id, (expected.get(id) ?? 0) + 1)
      expect(s.calls).toBe(expected.get(id))
      expect(s.calls).toBeGreaterThanOrEqual(snapshots.get(id) ?? 0)
      snapshots.set(id, s.calls)
    }
  })

  it("excludes cheap tools from calls but still tracks them per tool", () => {
    const s = track("ses_cheap", "todowrite")
    track("ses_cheap", "question")
    track("ses_cheap", "skill")
    expect(s.calls).toBe(0)
    expect(s.tools.get("todowrite")).toBe(1)
    expect(s.tools.get("question")).toBe(1)
    expect(s.tools.get("skill")).toBe(1)

    track("ses_cheap", "read")
    expect(s.calls).toBe(1)
    expect(s.tools.get("read")).toBe(1)
    expect(track("ses_cheap", "read")).toBe(s)
    expect(s.calls).toBe(2)
    expect(s.tools.get("read")).toBe(2)
  })
})
