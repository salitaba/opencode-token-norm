import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import { join } from "node:path"

const ws = process.argv[2]
const m1 = await import(pathToFileURL(join(ws, "lib", "f01.mjs")).href)
const m2 = await import(pathToFileURL(join(ws, "lib", "f02.mjs")).href)

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

check(m1.median, "median", [[3,1,4,2]], 2.5)
check(m1.median, "median", [[5,1,3]], 3)
check(m1.median, "median", [[2,4]], 3)
check(m2.rotate, "rotate", [[1,2,3,4,5], 2], [4,5,1,2,3])
check(m2.rotate, "rotate", [[1,2], 5], [2,1])
check(m2.rotate, "rotate", [[1,2,3], 0], [1,2,3])
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
