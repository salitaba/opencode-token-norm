import { pathToFileURL } from "node:url"
import { join } from "node:path"

const ws = process.argv[2]
const mod = await import(pathToFileURL(join(ws, "calc.mjs")).href)

const cases = [
  ["add(2,3)", mod.add(2, 3), 5],
  ["add(-4,4)", mod.add(-4, 4), 0],
  ["add(0,0)", mod.add(0, 0), 0],
  ["multiply(4,5)", mod.multiply(4, 5), 20],
  ["multiply(0,7)", mod.multiply(0, 7), 0],
]

let failed = 0
for (const [name, got, want] of cases) {
  if (got !== want) {
    failed++
    console.log(`FAIL ${name}: got ${got}, want ${want}`)
  }
}
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
