import { cartTotal } from "./lib/items.mjs"
import { applyDiscount } from "./lib/discount.mjs"
import { withTax } from "./lib/tax.mjs"

const near = (a, b) => Math.abs(a - b) < 1e-9

const cases = [
  ["cartTotal 2x10 + 1x5", cartTotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }]), 25],
  ["cartTotal empty", cartTotal([]), 0],
  ["applyDiscount 200 @10%", applyDiscount(200, 10), 180],
  ["applyDiscount 50 @50%", applyDiscount(50, 50), 25],
  ["withTax 100 @10%", withTax(100, 0.1), 110],
  ["withTax 20 @0%", withTax(20, 0), 20],
]

let failed = 0
for (const [name, got, want] of cases) {
  if (!near(got, want)) {
    failed++
    console.log(`FAIL ${name}: got ${got}, want ${want}`)
  } else {
    console.log(`PASS ${name}`)
  }
}
process.exit(failed ? 1 : 0)
