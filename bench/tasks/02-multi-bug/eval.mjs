import { pathToFileURL } from "node:url"
import { join } from "node:path"

const ws = process.argv[2]
const items = await import(pathToFileURL(join(ws, "lib", "items.mjs")).href)
const discount = await import(pathToFileURL(join(ws, "lib", "discount.mjs")).href)
const tax = await import(pathToFileURL(join(ws, "lib", "tax.mjs")).href)

const near = (a, b) => Math.abs(a - b) < 1e-9
const cases = [
  ["lineTotal", items.lineTotal({ price: 2.5, quantity: 4 }), 10],
  ["cartTotal empty", items.cartTotal([]), 0],
  ["cartTotal mixed", items.cartTotal([{ price: 10, quantity: 3 }, { price: 1.5, quantity: 2 }]), 33],
  ["applyDiscount 25%", discount.applyDiscount(80, 25), 60],
  ["applyDiscount 0%", discount.applyDiscount(10, 0), 10],
  ["withTax 20%", tax.withTax(50, 0.2), 60],
]

let failed = 0
for (const [name, got, want] of cases) {
  if (!near(got, want)) {
    failed++
    console.log(`FAIL ${name}: got ${got}, want ${want}`)
  }
}
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
