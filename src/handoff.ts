// Session handoff ("new session per task with a 3-line handoff").
//
// The norm says split at phase boundaries. In practice the split does not
// happen, because splitting means the user leaving the TUI, opening a new
// session, and re-typing context by hand -- three manual steps at exactly the
// moment the warm session feels cheapest to continue. So the rule loses to
// friction every time.
//
// This makes the split one tool call. The agent writes the handoff, the plugin
// persists it to disk, opens a NEW TUI session, and pre-fills that session's
// prompt with the handoff text. The user lands in a cold session with the
// context already typed, and presses enter.
//
// The prompt is pre-filled but NOT submitted by default. An auto-submitted
// handoff would start burning tokens on a task the user may have wanted to
// redirect, and the whole point of the split is to give them that beat. Pass
// submit: true when the continuation is genuinely unattended.

import { tool, type Plugin } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { HANDOFF_DIR } from "./config.js"
import { log } from "./log.js"

// The TUI processes /tui/execute-command asynchronously: the request returns
// once the command is dispatched, not once the new session is mounted.
// Appending the prompt too early lands the text in the OLD session's editor,
// which is worse than not splitting at all -- the user sees nothing and the
// handoff is lost.
const SWITCH_SETTLE_MS = Number.parseInt(process.env.TOKEN_NORM_SETTLE_MS ?? "", 10) || 350

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface HandoffArgs {
  task: string
  done: string
  next: string
  files?: string[]
  notes?: string
  submit?: boolean
}

// Plugin tools register for EVERY agent, subagents included. A subagent calling
// handoff would open a new TUI session in the middle of the parent's task --
// hijacking the user's screen for work they did not ask to split. Only a
// primary agent owns the session, so only a primary agent may end it.
//
// Resolved from the live agent list instead of a hardcoded name list, so agents
// the user adds later are classified correctly without touching this file.
async function isSubagent(client: any, agentName: string | undefined): Promise<boolean> {
  if (!agentName) return false
  try {
    const res = await client.app.agents()
    const agents = res?.data ?? res
    const found = Array.isArray(agents) ? agents.find((a: any) => a.name === agentName) : undefined
    return found?.mode === "subagent"
  } catch {
    // If the lookup fails, allow. A false block would strand the primary agent
    // with no way to split, which is the failure this plugin exists to prevent.
    return false
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

function renderHandoff({ task, done, next, files, notes }: HandoffArgs): string {
  const lines = [`## Handoff`, ``, `**Task:** ${task}`, `**Done:** ${done}`, `**Next:** ${next}`]
  if (files?.length) {
    lines.push(``, `**Files in play:**`)
    for (const f of files) lines.push(`- ${f}`)
  }
  if (notes) lines.push(``, `**Notes:**`, notes)
  return lines.join("\n")
}

export const HandoffPlugin: Plugin = async ({ client, directory }) => {
  return {
    tool: {
      handoff: tool({
        description: [
          "End the current session at a phase boundary and continue in a FRESH session.",
          "Persists a handoff note to disk, opens a new TUI session, and pre-fills its prompt",
          "with that note so the user only has to press enter.",
          "",
          "Use when: diagnosis is done and implementation has not started; the user asks for a",
          "new/clean session; context is large and the remaining work does not need the",
          "accumulated tool output; or the session-budget audit says to split.",
          "",
          "Write the handoff for a reader with ZERO context. Name real file paths and real",
          "identifiers you verified this session -- the new session cannot see your scrollback.",
        ].join("\n"),
        args: {
          task: tool.schema.string().describe("The one-line task the next session must accomplish."),
          done: tool.schema
            .string()
            .describe("What is already finished and verified. Be concrete; include findings worth keeping."),
          next: tool.schema.string().describe("The exact next action the fresh session should take first."),
          files: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Absolute paths (file:line where useful) the next session will need to open."),
          notes: tool.schema
            .string()
            .optional()
            .describe("Decisions, constraints, dead ends already ruled out, verified identifiers/commands."),
          submit: tool.schema
            .boolean()
            .optional()
            .describe("Auto-submit the handoff in the new session. Default false: the user presses enter."),
        },
        async execute(args, ctx) {
          if (await isSubagent(client, ctx.agent)) {
            return {
              title: "Handoff refused",
              output: [
                `handoff is not available to subagents (you are "${ctx.agent}", mode: subagent).`,
                `Return your findings to the parent agent and let it decide whether to split.`,
              ].join("\n"),
              metadata: { refused: "subagent", agent: ctx.agent },
            }
          }

          const body = renderHandoff(args)

          await fs.mkdir(HANDOFF_DIR, { recursive: true })
          const notePath = path.join(HANDOFF_DIR, `${stamp()}-${ctx.sessionID}.md`)
          // Persist BEFORE switching. If the TUI call fails, the handoff still
          // exists on disk and the user can recover it manually; the reverse
          // ordering would lose the note on exactly the failure that matters.
          await fs.writeFile(notePath, `${body}\n\n_from session ${ctx.sessionID} in ${directory}_\n`, "utf8")
          log(`${ctx.sessionID} handoff written to ${notePath}`)

          const prompt = `${body}\n\n_Handoff note: ${notePath}_\n`

          await client.tui.executeCommand({ body: { command: "session_new" } })
          await sleep(SWITCH_SETTLE_MS)
          await client.tui.appendPrompt({ body: { text: prompt } })
          if (args.submit) await client.tui.submitPrompt()

          await client.tui.showToast({
            body: {
              title: "Handoff",
              message: args.submit ? "New session started" : "New session ready — press enter",
              variant: "success",
            },
          })

          return {
            title: "Handed off to new session",
            output: [
              `Handoff written to ${notePath}`,
              `New session opened; prompt ${args.submit ? "submitted" : "pre-filled (awaiting enter)"}.`,
              ``,
              `STOP HERE. This session is over. Do not continue the task, do not make further`,
              `tool calls, and do not summarize beyond one line — the work now belongs to the`,
              `new session. Continuing here spends the context the handoff exists to discard.`,
            ].join("\n"),
            metadata: { notePath, submitted: !!args.submit },
          }
        },
      }),
    },
  }
}
