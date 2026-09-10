import { describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  process.env.TOKEN_NORM_ANNOUNCE_AT = "25"
  process.env.TOKEN_NORM_BOUNDARY_AT = "40"
  process.env.TOKEN_NORM_AUDIT_EVERY = "60"
  process.env.TOKEN_NORM_CHEAP_TOOLS = "todowrite,question,skill"
})

vi.mock("../src/log.js", () => ({ log: vi.fn() }))
vi.mock("../src/audit.js", () => ({ runAudit: vi.fn(() => "effective fresh tokens: 123k") }))

import { runAudit } from "../src/audit.js"
import { SessionBudgetPlugin } from "../src/session-budget.js"

const hooks = await SessionBudgetPlugin({} as never)

function blank() {
  return { title: "t", output: "tool output", metadata: {} }
}

async function callTool(sessionID: string, tool = "read"): Promise<string> {
  const output = blank()
  await hooks["tool.execute.after"]!({ tool, sessionID, callID: "call_1", args: {} }, output)
  return output.output
}

async function calls(sessionID: string, n: number, tool = "read"): Promise<string> {
  let last = ""
  for (let i = 0; i < n; i++) last = await callTool(sessionID, tool)
  return last
}

async function userMessage(sessionID: string, id: string | undefined, role = "user") {
  await hooks.event!({
    event: { type: "message.updated", properties: { info: { id, role, sessionID } } },
  } as never)
}

describe("SessionBudgetPlugin", () => {
  it("counts calls, but not cheap tools", async () => {
    await calls("ses_cheap", 100, "todowrite")
    const under = await calls("ses_cheap", 24)
    expect(under).not.toContain("TOKEN NORM")

    const at25 = await callTool("ses_cheap")
    expect(at25).toContain("25 tool calls")
    expect(at25).toContain("session split")
  })

  it("demands the cost statement once per session", async () => {
    await calls("ses_announce", 25)
    const after = await calls("ses_announce", 34)
    expect(after).not.toContain("TOKEN NORM")
  })

  it("runs the audit every 60 calls", async () => {
    await calls("ses_audit", 59)
    expect(runAudit).not.toHaveBeenCalled()

    const at60 = await callTool("ses_audit")
    expect(at60).toContain("Audit checkpoint")
    expect(at60).toContain("effective fresh tokens: 123k")
    expect(runAudit).toHaveBeenCalledWith("ses_audit")

    await calls("ses_audit", 59)
    expect(runAudit).toHaveBeenCalledTimes(1)

    const at120 = await callTool("ses_audit")
    expect(at120).toContain("Audit checkpoint")
    expect(runAudit).toHaveBeenCalledTimes(2)
  })

  it("fires the task-boundary reminder once per user message, not per tool call", async () => {
    const s = "ses_boundary"
    await calls(s, 40)
    await userMessage(s, undefined)
    for (let i = 0; i < 10; i++) await userMessage(s, "msg_1")

    const first = await callTool(s)
    expect(first.match(/TASK BOUNDARY/g)).toHaveLength(1)

    const second = await callTool(s)
    expect(second).not.toContain("TASK BOUNDARY")

    await userMessage(s, "msg_2")
    const third = await callTool(s)
    expect(third).toContain("TASK BOUNDARY")
  })

  it("ignores boundaries in a cold session, and assistant messages", async () => {
    const cold = "ses_cold"
    await calls(cold, 5)
    await userMessage(cold, "msg_cold")
    expect(await callTool(cold)).not.toContain("TASK BOUNDARY")

    const assistant = "ses_assistant"
    await calls(assistant, 40)
    await userMessage(assistant, "msg_assistant", "assistant")
    expect(await callTool(assistant)).not.toContain("TASK BOUNDARY")
  })

  it("adds the live call count at compaction, and nothing for unknown sessions", async () => {
    const known = "ses_compact"
    await calls(known, 3)
    const output = { context: [] as string[] }
    await hooks["experimental.session.compacting"]!({ sessionID: known }, output)
    expect(output.context).toHaveLength(1)
    expect(output.context[0]).toContain("3 tool calls")

    const unknown = { context: [] as string[] }
    await hooks["experimental.session.compacting"]!({ sessionID: "ses_never_seen" }, unknown)
    expect(unknown.context).toHaveLength(0)
  })

  it("evicts state when a session is deleted", async () => {
    const s = "ses_deleted"
    await calls(s, 25)
    await hooks.event!({
      event: { type: "session.deleted", properties: { info: { id: s } } },
    } as never)

    const again = await calls(s, 25)
    expect(again).toContain("25 tool calls")
  })

  it("swallows malformed events", async () => {
    await expect(hooks.event!({} as never)).resolves.toBeUndefined()
  })
})
