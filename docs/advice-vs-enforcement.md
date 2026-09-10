# Advice vs. enforcement

*Positioning reference. Use as the README hero table, a landing-page section, or the reply when someone asks "isn't this just prompt engineering?" Every row is backed by the 184-call, 3.0M-token session or by a shipped-and-fixed bug, all recorded in `docs/promo.md`.*

Every rule in a token norm is already in the agent's context. The gap is not knowledge. The gap is mechanism.

| Failure mode | The advice version | Why it loses | The mechanical version |
|---|---|---|---|
| Awareness | "Keep the token budget in mind." | It competes with the task in flight. The task always wins; it is what the user asked for ten seconds ago. | Tool calls are counted, and at 25 calls a `<system-reminder>` is stapled onto tool output, the channel the model already reads. |
| Checkpoint | "Run the usage audit periodically." | The agent complies, reports the numbers, and keeps going. Compliance without action reads like success. | The plugin runs `scripts/usage-audit.py` itself, read-only against the session DB, and injects the numbers every 60 calls. |
| Override scope | "do everything, don't ask" | The grant silently carries into the next task. Nothing revokes it because nothing was designed to. | A new user message past 40 calls marks a boundary; the stale override is revoked. Unique to this plugin. |
| The split | "Start a fresh session at phase boundaries." | Cold-start fear; the agent always finds a reason to push on. | `handoff` persists the note to disk, opens a clean session, and pre-fills it. The user presses enter. |
| Reminder hygiene | Nothing; repeated reminders are assumed harmless. | Repetition becomes wallpaper, and the model generalizes to skipping every system-reminder. | Dedupe on message identity. v0 fired one reminder 61 times for a single message; that bug is now the design rule. |

## Framing rules

- Lead with the paradox, not the autobiography: the agent already knew, and continued anyway. Knowing is not stopping.
- Never call the agent lazy. The honest description is *compliance without action*; it did what was asked and still burned the budget.
- The three enforcement pillars, in order of importance: interrupt in-channel, run the audit yourself, expire overrides per task. Handoff is the escape hatch the reminders point at, not the headline.
- Hold the 61-reminders bug for the "how is this not annoying?" reply in short-form posts. In long-form, it becomes the best section; the honest engineering story. Keep it out of the pitch.

## Not this

- Not a cost dashboard. It enforces during the session; reporting is a side effect.
- Not a replacement for a token norm in `AGENTS.md`. It enforces the norm mechanically; the text still defines what "on budget" means.
- Not prompt engineering with extra steps. The reminder is not a better-worded instruction; it is a different delivery mechanism attached to tool output.
