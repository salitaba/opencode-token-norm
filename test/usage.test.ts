import { describe, expect, it } from "vitest"
import { UsageTracker, effectiveFresh, median, bloat, attribution, type StepTokens } from "../src/usage.js"

type PartialSteps = Omit<Partial<StepTokens>, "cache"> & { cache?: Partial<StepTokens["cache"]> }

function tokens(partial: PartialSteps = {}): StepTokens {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    ...partial,
    cache: { read: partial.cache?.read ?? 0, write: partial.cache?.write ?? 0 },
  }
}

function step(
  tracker: UsageTracker,
  partID: string,
  sessionID: string,
  t: PartialSteps = {},
  cost = 0,
): void {
  tracker.handleEvent({
    type: "message.part.updated",
    properties: { part: { id: partID, sessionID, type: "step-finish", cost, tokens: tokens(t) } },
  })
}

function child(tracker: UsageTracker, id: string, parentID: string): void {
  tracker.handleEvent({ type: "session.created", properties: { info: { id, parentID } } })
}

describe("effectiveFresh", () => {
  it("mirrors usage-audit.py: input + 0.1*read + 1.25*write, output excluded", () => {
    expect(effectiveFresh(tokens({ input: 100, output: 999, cache: { read: 1000, write: 40 } }))).toBe(250)
    expect(effectiveFresh(undefined)).toBe(0)
  })
})

describe("UsageTracker step accumulation", () => {
  it("accumulates cost, effective tokens, context and peak per session", () => {
    const tracker = new UsageTracker()
    step(tracker, "p1", "ses_a", { input: 1000, output: 200, cache: { read: 4000, write: 100 } }, 0.5)
    step(tracker, "p2", "ses_a", { input: 3000, output: 100, cache: { read: 8000, write: 0 } }, 0.25)

    const s = tracker.get("ses_a")
    expect(s.stepCount).toBe(2)
    expect(s.costUsd).toBeCloseTo(0.75)
    expect(s.effectiveTokens).toBeCloseTo(1525 + 3800)
    // context = input + cache.read + cache.write + output
    expect(s.contextNow).toBe(3000 + 8000 + 0 + 100)
    expect(s.contextPeak).toBe(3000 + 8000 + 0 + 100)
    expect(s.history).toHaveLength(2)
    expect(s.history[1].tokens.input).toBe(3000)
  })

  it("dedupes a step-finish part delivered twice", () => {
    const tracker = new UsageTracker()
    step(tracker, "p1", "ses_a", { input: 10 }, 0.1)
    step(tracker, "p1", "ses_a", { input: 10 }, 0.1)
    expect(tracker.get("ses_a").stepCount).toBe(1)
    expect(tracker.get("ses_a").costUsd).toBeCloseTo(0.1)
  })

  it("records positive context deltas only, and compaction clears them", () => {
    const tracker = new UsageTracker()
    step(tracker, "p1", "ses_a", { input: 100 })
    step(tracker, "p2", "ses_a", { input: 300 })
    step(tracker, "p3", "ses_a", { input: 200 })
    expect(tracker.get("ses_a").deltas).toEqual([300 - 100])

    tracker.handleEvent({ type: "session.compacted", properties: { sessionID: "ses_a" } })
    expect(tracker.get("ses_a").contextNow).toBe(0)
    expect(tracker.get("ses_a").deltas).toEqual([])
    expect(tracker.get("ses_a").costUsd).toBe(0)
    expect(tracker.get("ses_a").stepCount).toBe(3)
    // history survives compaction: spend happened, the window is what reset
    expect(tracker.get("ses_a").history).toHaveLength(3)
  })

  it("captures provider/model from assistant messages", () => {
    const tracker = new UsageTracker()
    tracker.handleEvent({
      type: "message.updated",
      properties: { info: { role: "assistant", sessionID: "ses_a", providerID: "anthropic", modelID: "claude" } },
    })
    expect(tracker.get("ses_a").providerID).toBe("anthropic")
    expect(tracker.get("ses_a").modelID).toBe("claude")
  })

  it("swallows malformed events", () => {
    const tracker = new UsageTracker()
    expect(() => tracker.handleEvent(undefined)).not.toThrow()
    expect(() => tracker.handleEvent({})).not.toThrow()
    expect(() => tracker.handleEvent({ type: "message.part.updated", properties: {} })).not.toThrow()
    expect(() => step(tracker, "only-id", "ses_a")).not.toThrow()
  })
})

describe("child rollup", () => {
  it("sums cost/tokens/calls across descendants and finds the root", () => {
    const tracker = new UsageTracker()
    step(tracker, "root1", "ses_root", { input: 1000, cache: { read: 1000 } }, 1)
    child(tracker, "ses_child", "ses_root")
    child(tracker, "ses_grand", "ses_child")
    step(tracker, "c1", "ses_child", { input: 500 }, 0.5)
    step(tracker, "g1", "ses_grand", { input: 200 }, 0.2)

    expect(tracker.rootOf("ses_grand")).toBe("ses_root")
    expect(tracker.rootOf("ses_root")).toBe("ses_root")
    const r = tracker.rollup("ses_root")
    expect(r.sessions).toBe(3)
    expect(r.costUsd).toBeCloseTo(1.7)
    expect(r.effectiveTokens).toBeCloseTo(1800)
    expect(tracker.rollup("ses_child").sessions).toBe(2)
  })

  it("counts budgeted tool calls in the rollup", () => {
    const tracker = new UsageTracker()
    child(tracker, "ses_child", "ses_root")
    tracker.noteToolCall("ses_root", "read", {}, { output: "x" }, true)
    tracker.noteToolCall("ses_root", "todowrite", {}, { output: "y" }, false)
    tracker.noteToolCall("ses_child", "bash", {}, { output: "z" }, true)
    expect(tracker.rollup("ses_root").calls).toBe(2)
  })

  it("retires deleted sessions to a totals-only tombstone", () => {
    const tracker = new UsageTracker()
    child(tracker, "ses_child", "ses_root")
    step(tracker, "c1", "ses_child", { input: 500 }, 0.5)
    tracker.noteToolCall("ses_child", "read", { filePath: "/repo/a.ts" }, { output: "aaaa" }, true)
    tracker.handleEvent({ type: "session.deleted", properties: { info: { id: "ses_child" } } })
    // Ledger survives: spend stays in the root rollup, reachability stays.
    expect(tracker.rollup("ses_root").sessions).toBe(2)
    expect(tracker.rollup("ses_root").costUsd).toBeCloseTo(0.5)
    expect(tracker.rollup("ses_root").calls).toBe(1)
    // Detail freed: no live context, no attribution, no history.
    const retired = tracker.get("ses_child")
    expect(retired.retired).toBe(true)
    expect(retired.contextNow).toBe(0)
    expect(retired.history).toHaveLength(0)
    // Late zombie events for the retired id are ignored, never new spend.
    step(tracker, "zombie", "ses_child", { input: 999 }, 9)
    expect(tracker.rollup("ses_root").costUsd).toBeCloseTo(0.5)
    // Live grandchildren stay reachable through the tombstone.
    child(tracker, "ses_grand", "ses_child")
    step(tracker, "g1", "ses_grand", { input: 200 }, 0.2)
    expect(tracker.rollup("ses_root").costUsd).toBeCloseTo(0.7)
    expect(tracker.rollup("ses_root").sessions).toBe(3)
  })
})

describe("attribution", () => {
  it("tracks output bytes per tool, repeated reads, images, and edited files", () => {
    const tracker = new UsageTracker()
    tracker.noteToolCall("ses_a", "read", { filePath: "/repo/a.ts" }, { output: "aaaa" }, true)
    tracker.noteToolCall("ses_a", "read", { filePath: "/repo/a.ts" }, { output: "bbbb" }, true)
    tracker.noteToolCall("ses_a", "read", { filePath: "/repo/img.png" }, { output: "x" }, true)
    tracker.noteToolCall("ses_a", "bash", {}, { output: "12345678" }, true)
    tracker.noteToolCall("ses_a", "edit", { filePath: "/repo/a.ts" }, { output: "ok" }, true)

    const s = tracker.get("ses_a")
    const a = attribution(s)
    expect(a.topTools[0]).toEqual({ tool: "read", bytes: 9 })
    expect(a.topTools[1]).toEqual({ tool: "bash", bytes: 8 })
    expect(a.repeated).toEqual([{ file: "/repo/a.ts", count: 2 }])
    expect(a.images).toBe(1)
    expect(tracker.editedFiles("ses_a")).toEqual(["/repo/a.ts"])
  })

  it("falls back to directory-level file.edited when no tool args named a file", () => {
    const tracker = new UsageTracker()
    tracker.handleEvent({ type: "file.edited", properties: { file: "/repo/b.ts" } })
    expect(tracker.editedFiles("ses_a")).toEqual(["/repo/b.ts"])
  })
})

describe("bloat", () => {
  it("flags a last delta above 2x the median and stays quiet otherwise", () => {
    const tracker = new UsageTracker()
    for (const input of [0, 100, 200, 300, 400, 500]) step(tracker, `p${input}`, "ses_a", { input })
    let s = tracker.get("ses_a")
    expect(median(s.deltas)).toBe(100)
    expect(bloat(s).flagged).toBe(false)

    step(tracker, "big", "ses_a", { input: 1100 })
    s = tracker.get("ses_a")
    expect(bloat(s).lastDelta).toBe(600)
    expect(bloat(s).flagged).toBe(true)
    expect(bloat(new UsageTracker().get("ses_empty")).flagged).toBe(false)
  })
})
