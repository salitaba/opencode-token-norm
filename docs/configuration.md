# Configuration

*All optional, all environment variables, and the defaults are the ones real
sessions argued for — [the design notes](design.md) explain why.*

Three thresholds — `TOKEN_NORM_ANNOUNCE_AT`, `TOKEN_NORM_AUDIT_EVERY`,
`TOKEN_NORM_BOUNDARY_AT` — plus two kill switches, `TOKEN_NORM_BUDGET` and
`TOKEN_NORM_HANDOFF`. The measured budgets are opt-in: set one and the plugin
staples a status block onto tool output the first time each metric crosses it
(`TOKEN_NORM_MODE` controls how hard that bites). The rest are paths you will
probably never touch.

| Variable | Default | Meaning |
|---|---|---|
| `TOKEN_NORM_ANNOUNCE_AT` | `25` | Calls before the cost-statement reminder |
| `TOKEN_NORM_AUDIT_EVERY` | `60` | Calls between audit checkpoints |
| `TOKEN_NORM_BOUNDARY_AT` | `40` | Session size above which a new user message is a task boundary |
| `TOKEN_NORM_MODE` | `warn` | `observe` logs only; `warn` injects; `handoff` adds a skeleton at a pause; `block` refuses non-cheap tools |
| `TOKEN_NORM_MAX_COST` | unset | USD budget from provider cost |
| `TOKEN_NORM_MAX_EFFECTIVE_TOKENS` | unset | Fresh-token budget (input + 0.1×cache read + 1.25×cache write) |
| `TOKEN_NORM_MAX_TOOL_CALLS` | unset | Budgeted tool calls; cheap tools excluded |
| `TOKEN_NORM_CONTEXT_WARN` | `0.8` | Fraction of the context window that counts as pressure |
| `TOKEN_NORM_CONTEXT_LIMIT` | model limit | Override the window size in tokens (bypasses the cached model lookup) |
| `TOKEN_NORM_CHEAP_TOOLS` | `todowrite,question,skill` | Tools that do not count toward the budget |
| `TOKEN_NORM_HANDOFF_DIR` | `~/.local/share/opencode/handoff` | Where handoff notes are written |
| `TOKEN_NORM_LOG` | `~/.local/share/opencode/token-norm.log` | Threshold event log |
| `TOKEN_NORM_PYTHON` | `python3` | Interpreter for the audit script |
| `TOKEN_NORM_AUDIT_SCRIPT` | bundled | Override the audit script path |
| `TOKEN_NORM_SETTLE_MS` | `350` | Minimum wait after `session_new` before pre-filling (floor) |
| `TOKEN_NORM_SWITCH_WAIT_MS` | `2000` | Max wait for the new session before appending the prompt |
| `TOKEN_NORM_BUDGET` | `1` | Set `0` to disable the budget half |
| `TOKEN_NORM_HANDOFF` | `1` | Set `0` to disable the handoff tool |

The model window is read from the provider config once per provider/model and
cached for the life of the opencode process. Restart after changing provider
settings, or set `TOKEN_NORM_CONTEXT_LIMIT`, which bypasses the cache.

Every `~/.local/share` above follows `XDG_DATA_HOME` when it is set.

The cheap set defaults to `todowrite`, `question`, and `skill`: planning and
asking should never burn the budget, since both usually *save* calls. Reads and
greps do count, because context is the thing you are paying for. To exempt them
anyway:

```sh
TOKEN_NORM_CHEAP_TOOLS=todowrite,question,skill,read,grep,glob
```

The variable replaces the default set rather than extending it, so list every
tool you want exempt.
