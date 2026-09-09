# Launch & promo copy

Reference copy for announcing `opencode-token-norm`. Not shipped in the npm tarball
(`package.json` `files` whitelists `dist`, `scripts`, `README.md`, `LICENSE`).

## Status

| Target | Link | State |
| --- | --- | --- |
| npm | https://www.npmjs.com/package/opencode-token-norm | published `0.1.0` |
| GitHub | https://github.com/salitaba/opencode-token-norm | public |
| Release | https://github.com/salitaba/opencode-token-norm/releases/tag/v0.1.0 | tagged |
| opencode ecosystem PR | https://github.com/anomalyco/opencode/pull/48182 | open, awaiting review |
| awesome-opencode PR | https://github.com/awesome-opencode/awesome-opencode/pull/693 | open, awaiting review |
| Discord showcase | https://opencode.ai/discord | copy below, unposted |
| Reddit / X / HN | — | copy below, unposted |

## Positioning

Lead with the **enforcement mechanism**, not the handoff.

`opencode-handoff` (joshuadavidthomas) and `opencode-session-handoff` (bristena-op)
already exist and overlap the handoff half by roughly 70%. Pitched as a handoff
plugin this loses to the incumbent. The budget enforcement half has no ecosystem
equivalent; handoff is bundled as the escape hatch the reminders point at.

Three concrete hooks, all backed by real sessions:

- A 184-call, 3.0M effective-token session where the norm was in context the whole time.
- At 195k deep the agent ran the audit, reported 77x cache / bloat HIGH, and continued
  anyway — because a `do everything` override from task 1 silently carried into task 2.
  Per-task override expiry is the unique feature.
- An early version fired the boundary reminder 61 times for one user message; dedupe
  compared a call count instead of message identity. Reminders that repeat become
  wallpaper and the agent learns to skip all system-reminders. Now deduped on message id.

## Discord showcase (#showcase)

> **opencode-token-norm** — token budget enforcement that doesn't rely on the agent remembering it
>
> I had a rule in my AGENTS.md: state expected cost before a big task, split at phase boundaries, run the audit. It was in context every single session. Then I watched a 184-call, 3.0M effective-token session go by with the norm sitting right there, unread.
>
> The failure that convinced me to write code instead of more prose: at 195k deep the agent *did* run the audit, *did* report 77x cache and bloat HIGH — and continued anyway, because a "do everything" override I gave for task 1 had silently carried into task 2.
>
> So the plugin does the parts an instruction can't:
> - counts tool calls, then staples a `<system-reminder>` onto tool output at the threshold — the check arrives whether or not the agent is curious about cost
> - runs the usage audit itself and injects the numbers. "Run this and report it" is advice, and advice at a checkpoint loses to the task in flight
> - overrides expire with the task that granted them. New request naming new files = new task = override gone
> - bundles a `handoff` tool as the escape hatch the reminders point at: note written to disk first, then a fresh session opens with it pre-filled (not auto-submitted unless you ask)
>
> One bug worth confessing since it shaped the design: an early version fired the boundary reminder **61 times for one user message** — dedupe compared a call count instead of message identity. Reminders that repeat become wallpaper and the agent starts skipping *all* system-reminders. Deduped on message id now.
>
> `npm i opencode-token-norm`, add it to `plugin` in opencode.json. Kill switches `TOKEN_NORM_BUDGET=0` / `TOKEN_NORM_HANDOFF=0`.
> https://github.com/salitaba/opencode-token-norm

## Reddit self-post (r/LocalLLaMA, r/ChatGPTCoding)

**Title:** I put my "watch your token budget" instructions in the system prompt for weeks. The agent ignored them. So I made them fire on their own.

I write agent instructions for a living lately, and I had a token-discipline norm loaded in every session: size the task first, state the expected cost, split at phase boundaries, run the audit on long jobs.

It did not work, and the way it failed is the interesting part.

**Failure 1 — presence isn't enforcement.** A 184-call session, 3.0M effective tokens. The norm was in context the entire time. Instructions compete with the task in flight, and the task always wins, because the task is what the user just asked for and the norm is what the user asked for weeks ago.

**Failure 2 — the audit is advice.** I added "run the usage audit at checkpoints." At 195k the agent ran it, reported 77x cache ratio and bloat HIGH... and kept going. Reporting a number is not the same as acting on it.

**Failure 3 — overrides leak.** That session continued because I'd said "do everything, don't ask" for task 1, and the grant silently carried into task 2. Nothing revoked it. Nothing was supposed to.

So I wrote a plugin that does the parts prose can't do:

- It counts tool calls and **staples a `<system-reminder>` onto tool output** when you cross the threshold. Not a hope that the agent checks — an interrupt in the channel it's already reading.
- It **runs the audit itself** and injects the numbers into that reminder.
- **Per-task override expiry.** A "do everything" grant is scoped to the request that granted it. A new request naming new files is a new task, and the override is gone. This is the piece I haven't seen anywhere else.
- Cheap tools (todo, question, skill) don't count toward the budget, so bookkeeping doesn't trip the alarm.
- A bundled `handoff` tool for the escape hatch: write the note to disk *first*, then open a fresh session with the note pre-filled. Findings are small and survive a handoff; the 80k of tool output that produced them does not.

One bug from development that's a general lesson: an early version fired the boundary reminder **61 times for a single user message** — the dedupe compared a call count instead of message identity. Repeated reminders become wallpaper, and worse, the agent generalizes and starts ignoring *every* system-reminder. If you inject anything into an agent's context, dedupe on message identity, not on a counter.

It's for opencode: `npm i opencode-token-norm`. MIT.
https://github.com/salitaba/opencode-token-norm

Curious whether anyone has solved the override-expiry problem differently — "do everything" leaking across task boundaries feels like it should bite every agent harness, not just mine.

## X / Twitter thread

**1/**
I kept a token-discipline rule in my agent's system prompt for weeks.

Then I watched a 184-call, 3.0M-token session run with that rule in context the whole time.

Instructions don't enforce. Code does. So:

**2/**
The moment I gave up on prose:

At 195k tokens deep, the agent ran the usage audit, reported "77x cache ratio, bloat HIGH"...

and continued anyway.

Reporting a number ≠ acting on it.

**3/**
Root cause was worse. I'd said "do everything, don't ask" for task 1.

That override silently carried into task 2. Nothing revoked it. Nothing was designed to.

**4/**
opencode-token-norm does the parts an instruction can't:

• counts tool calls, staples a system-reminder onto tool output at the threshold
• runs the audit itself, injects the numbers
• overrides expire with the task that granted them
• bundled handoff tool as the escape hatch

**5/**
Bug I shipped and fixed, generally useful:

v0 fired the reminder 61 times for ONE user message. Dedupe compared a call count, not message identity.

Repeated reminders become wallpaper — and the agent learns to skip *all* system-reminders.

Dedupe on message id.

**6/**
`npm i opencode-token-norm`
MIT, for @opencodeai

https://github.com/salitaba/opencode-token-norm

## Hacker News

**Title:** Show HN: Token budget enforcement for coding agents that fires without being asked

I had a token-discipline norm loaded into my coding agent's context every session — size the task, state the cost, split at phase boundaries, run the audit. It was ignored through a 184-call, 3.0M effective-token session.

The instructive failure wasn't ignorance, it was compliance-without-action: at 195k tokens the agent ran the audit I asked for, reported a 77x cache ratio and "bloat HIGH," and continued. The reason it continued was that a "do everything, don't ask" override granted for the previous task had never expired.

The plugin replaces three pieces of advice with mechanism: (1) tool calls are counted and a `<system-reminder>` is stapled onto tool output at the threshold, so the check arrives in the channel the model is already reading rather than depending on it to look; (2) the audit is executed by the plugin and its numbers injected, since "run this and report it" competes with the task in flight and loses; (3) overrides are scoped to the request that granted them, so a new request naming new files revokes the old grant.

A handoff tool is bundled as the escape hatch the reminders point at — it persists the note to disk before switching sessions, which matters because the findings are small and survive a handoff while the tool output that produced them does not.

Design note that generalizes beyond this project: an early version fired the boundary reminder 61 times for a single user message, because the dedupe compared a call count instead of message identity. Repeated injections become wallpaper and the model generalizes to ignoring the whole `system-reminder` channel. Dedupe on message identity.

MIT, targets opencode. https://github.com/salitaba/opencode-token-norm

## Submitted PR bodies

Kept verbatim for reference if either PR needs reopening.

### anomalyco/opencode#48182 — `docs: add opencode-token-norm to ecosystem`

Single row appended to the Plugins table in
`packages/web/src/content/docs/ecosystem.mdx`, base branch `dev`:

```
| [opencode-token-norm](https://github.com/salitaba/opencode-token-norm)                             | Enforce a token budget with self-firing cost reminders, plus a session handoff tool                |
```

### awesome-opencode/awesome-opencode#693 — `docs: add token-norm to plugins`

New file `data/plugins/token-norm.yaml`, base branch `main`:

```yaml
name: Token Norm
repo: https://github.com/salitaba/opencode-token-norm
tagline: Token budget enforcement that fires on its own, plus a session handoff tool
description: >-
  Counts tool calls per session and staples a system-reminder onto tool output
  at the cost-statement threshold and periodically after, so the budget check
  happens even when the agent is deep in a task. It runs the usage audit itself
  and injects the numbers rather than telling the agent to run one. Overrides
  like "do everything" expire with the task that granted them instead of
  silently carrying into the next request. Bundles a handoff tool that writes
  the note to disk, then opens a fresh session with the note pre-filled.
tags:
  - tokens
  - cost
  - context
  - handoff
  - sessions
```
