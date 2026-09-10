# 20-second demo screencast: script and shot list

*No recording assets exist yet. This is the storyboard, the setup that makes the interrupt fire inside 20 seconds instead of 25 tool calls, and the publishing notes. Pair with `docs/post-mortem.md`.*

## Goal

Show, in one unbroken take, the exact moment the plugin interrupts an agent that is deep in a task, then end on the handoff. No feature narration. The visual is the argument.

## Pre-flight

- Throwaway project directory with a task that naturally takes 12+ tool calls (for example "add dark mode to the settings page" in a small web app). Do not record in a repo with secrets.
- Lower the thresholds for demo speed. In the terminal that launches opencode:

  ```
  export TOKEN_NORM_ANNOUNCE_AT=6
  export TOKEN_NORM_BOUNDARY_AT=8
  export TOKEN_NORM_AUDIT_EVERY=10
  ```

- Terminal: 120x30, 18pt+ font, notifications off, prompt trimmed, CWD visible.
- Run one throwaway session first so the audit has a "last" session and shows plausible numbers. Screen only what you are happy to publish: the audit reads the local session DB read-only (`~/.local/share/opencode/opencode.db`, override with `OPENCODE_DB`).
- Record with `asciinema rec demo.cast` for a real TUI take. If you want deterministic typing, test a VHS/`.tape` draft before committing to it.
- Before recording, run a private rehearsal take and watch it end to end. The demo depends on threshold timing, not on a live model behaving on cue.

## Shot list

| Time | Visual | Overlay caption |
|---|---|---|
| 0:00-0:02 | Terminal at the project root. Cursor types `opencode`. | "opencode-token-norm, 20 seconds." |
| 0:02-0:06 | Session starts; paste the task. Tool calls begin scrolling. | "Every tool call is counted." |
| 0:06-0:11 | At call 6, the reminder appears attached to tool output and the agent answers with the cost statement. Slow the scroll here. | "The check arrives stapled to the output the model is already reading." |
| 0:11-0:15 | The audit block appears with real numbers (cache ratio, bloat). Agent summarizes and proposes the split. | "The plugin ran the audit itself. No 'agent, please go look'." |
| 0:15-0:18 | The agent calls `handoff`; a new session opens with the note pre-filled. | "One tool call: state to disk, clean session, prompt pre-filled." |
| 0:18-0:20 | End card: `npm i opencode-token-norm` and the repo URL. | - |

## Publishing

- Silent by default, captions burned in: it autoplays in feeds and the README without audio.
- Export as MP4 for X and HN, GIF under 5 MB (2x speed if needed) for the README hero and npm page. Publish the `demo.cast` too only if the take has no throwaway artifacts you would mind shipping.
- Alt text: "Terminal recording. An agent mid-task is interrupted by a system reminder showing real token usage; it summarizes the session and opens a fresh one with a handoff note pre-filled."
- Reuse the same take as the reply to "how is this not annoying?": it shows one interrupt, not a barrage.
