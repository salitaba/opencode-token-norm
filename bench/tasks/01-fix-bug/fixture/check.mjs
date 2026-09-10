import { add, multiply } from "./calc.mjs"

const cases = [
  ["add(2, 3)", add(2, 3), 5],
  ["add(-4, 4)", add(-4, 4), 0],
  ["multiply(4, 5)", multiply(4, 5), 20],
]

let failed = 0
for (const [name, got, want] of cases) {
  if (got !== want) {
    failed++
    console.log(`FAIL ${name}: got ${got}, want ${want}`)
  } else {
    console.log(`PASS ${name}`)
  }
}
process.exit(failed ? 1 : 0)
