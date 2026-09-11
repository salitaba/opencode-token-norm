# Run the audit yourself

The audit script ships inside the package, and reads the same DB the plugin does.
In a project where you installed it (`npm i opencode-token-norm`), run it from
that project root:

```sh
A=node_modules/opencode-token-norm/scripts/usage-audit.py

python3 $A --last                  # most recently updated session
python3 $A --session <session-id>  # one specific session (what the plugin runs)
python3 $A --top 5                 # rank the 5 most recent by effective fresh tokens (a weighted input metric)
python3 $A --receipt               # shareable snapshot, most recent session
python3 $A --receipt <session-id>  # ...or a named one
```

Those four modes are mutually exclusive, and each accepts `--json` for the raw
numbers — pipe the audit into your own tooling rather than parsing the table.
Session IDs come from `--top`, or from the `announce-threshold` lines in
`token-norm.log`.

The one number to read is `effective fresh tokens = input + 0.1·cache_read +
1.25·cache_write` — a cost-weighted input, not a dollar amount. The formula and
its multipliers are explained in
[the metric](design.md#the-effective-fresh-metric);
actual spend is the provider-reported `cost_usd`, which some gateways report as `0`.

## Shareable receipt

`--receipt` prints a paste-ready snapshot of any session — the same numbers, laid
out for a screenshot. The verdict is honest rather than flattering: median
context past 60k earns `watch`, past 120k earns `HIGH`, and nothing rounds in
your favor. Color is applied only on a TTY, so piping to a file is already plain
text; `--no-color` or `NO_COLOR=1` forces it in a terminal too.

Run it on your worst session. That verdict argues the case better than any
benchmark could.

```text
============================================================
                  OPENCODE SESSION RECEIPT
============================================================
  Token norm: boundary dedupe regression
  ses_f75afcd6dffeRZXwjB7EgV2czv
  cc/claude-opus-5 · 9router-anthropic · 2026-09-10 11:47
------------------------------------------------------------
                   EFFECTIVE FRESH TOKENS
                            687k
       input 56k + cache read ×0.1 394k + cache write ×1.25 237k
           of 4.2M raw input · cache discount 84%
------------------------------------------------------------
  cache ratio       40x  cache read ÷ (input+output)
  tool calls        52   bash 37 · read 9 · todowrite 2
  context / call    84k median · 122k peak
  system floor      27k (first call)
  output            44k
------------------------------------------------------------
  verdict           watch — context creeping past 60k
============================================================
  enforce the budget, not the advice
  npm i opencode-token-norm
============================================================
```
