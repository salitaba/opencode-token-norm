import assert from "node:assert/strict"
import * as m1 from "./text.mjs"

let failed = 0
const check = (fn, name, args, want) => {
  let got
  try {
    got = fn(...args)
  } catch (err) {
    got = "threw: " + err.message
  }
  try {
    assert.deepStrictEqual(got, want)
  } catch {
    failed++
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
}

check(m1.slugify, "slugify", [" Hello World "], "hello-world")
check(m1.slugify, "slugify", ["a b c"], "a-b-c")
check(m1.slugify, "slugify", ["Solo"], "solo")
check(m1.truncate, "truncate", ["hello", 3], "hel...")
check(m1.truncate, "truncate", ["hi", 5], "hi")
check(m1.truncate, "truncate", ["abc", 0], "...")
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
