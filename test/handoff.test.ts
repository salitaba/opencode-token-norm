import fs from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  const base = process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"
  const sep = base.endsWith("/") ? "" : "/"
  process.env.TOKEN_NORM_HANDOFF_DIR = `${base}${sep}token-norm-handoff-test-${process.pid}`
  process.env.TOKEN_NORM_SETTLE_MS = "0"
  process.env.TOKEN_NORM_LOG = `${base}${sep}token-norm-handoff-test-${process.pid}.log`
})

import { HandoffPlugin } from "../src/handoff.js"

const DIR = process.env.TOKEN_NORM_HANDOFF_DIR!

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true })
})

function fakeClient(agents: () => Promise<any>) {
  let filesAtSwitch = -1
  return {
    client: {
      app: { agents: vi.fn(agents) },
      tui: {
        executeCommand: vi.fn(async () => {
          filesAtSwitch = fs.existsSync(DIR) ? fs.readdirSync(DIR).length : 0
        }),
        appendPrompt: vi.fn(async (_input?: any) => {}),
        submitPrompt: vi.fn(async () => {}),
        showToast: vi.fn(async () => {}),
      },
    },
    filesAtSwitch: () => filesAtSwitch,
  }
}

function ctx(agent = "build") {
  return {
    sessionID: "ses_handoff_test",
    messageID: "msg_1",
    agent,
    directory: "/repo",
    worktree: "/repo",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

async function load(client: unknown) {
  const hooks = await HandoffPlugin({ client, directory: "/repo" } as never)
  return hooks.tool!.handoff
}

const args = { task: "Fix expiry", done: "Diagnosed", next: "Patch" }

describe("handoff tool", () => {
  it("refuses subagents: no file, no TUI switch", async () => {
    const { client } = fakeClient(async () => ({ data: [{ name: "explore", mode: "subagent" }] }))
    const handoff = await load(client)
    const result = (await handoff.execute(args, ctx("explore"))) as any

    expect(result.metadata.refused).toBe("subagent")
    expect(client.tui.executeCommand).not.toHaveBeenCalled()
    expect(fs.existsSync(DIR)).toBe(false)
  })

  it("allows the call when the agent lookup fails", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("server unreachable")
    })
    const handoff = await load(client)
    const result = (await handoff.execute({ ...args, submit: false }, ctx())) as any

    expect(result.metadata.notePath).toBeTruthy()
    expect(client.tui.executeCommand).toHaveBeenCalledWith({ body: { command: "session_new" } })
  })

  it("persists the note before switching, then pre-fills and submits", async () => {
    const { client, filesAtSwitch } = fakeClient(async () => ({ data: [] }))
    const handoff = await load(client)
    const result = (await handoff.execute(
      {
        task: "Fix token expiry",
        done: "Diagnosed at /repo/src/auth/token.ts:88",
        next: "Change < to <=",
        files: ["/repo/src/auth/token.ts:88"],
        notes: "avoid clock skew",
      },
      ctx(),
    )) as any

    expect(filesAtSwitch()).toBe(1)
    expect(client.tui.submitPrompt).toHaveBeenCalledTimes(1)

    const note = fs.readFileSync(result.metadata.notePath, "utf8")
    expect(note).toContain("**Task:** Fix token expiry")
    expect(note).toContain("**Done:** Diagnosed at /repo/src/auth/token.ts:88")
    expect(note).toContain("**Next:** Change < to <=")
    expect(note).toContain("- /repo/src/auth/token.ts:88")
    expect(note).toContain("**Notes:**\navoid clock skew")
    expect(note).toContain("ses_handoff_test")

    const appended = client.tui.appendPrompt.mock.calls[0][0] as any
    expect(appended.body.text).toContain(result.metadata.notePath)
  })

  it("keeps the persisted note when the TUI switch fails", async () => {
    const { client } = fakeClient(async () => ({ data: [] }))
    client.tui.executeCommand.mockRejectedValueOnce(new Error("tui gone"))
    const handoff = await load(client)

    await expect(handoff.execute(args, ctx())).rejects.toThrow("tui gone")
    expect(fs.readdirSync(DIR)).toHaveLength(1)
  })

  it("submit: false stops at the pre-filled prompt", async () => {
    const { client } = fakeClient(async () => ({ data: [] }))
    const handoff = await load(client)
    const result = (await handoff.execute({ ...args, submit: false }, ctx())) as any

    expect(client.tui.submitPrompt).not.toHaveBeenCalled()
    expect(result.metadata.submitted).toBe(false)
    expect(client.tui.appendPrompt).toHaveBeenCalledTimes(1)
  })
})
