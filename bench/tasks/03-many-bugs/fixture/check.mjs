import assert from "node:assert/strict"
import * as f01 from "./lib/f01.mjs"
import * as f02 from "./lib/f02.mjs"
import * as f03 from "./lib/f03.mjs"
import * as f04 from "./lib/f04.mjs"
import * as f05 from "./lib/f05.mjs"
import * as f06 from "./lib/f06.mjs"
import * as f07 from "./lib/f07.mjs"
import * as f08 from "./lib/f08.mjs"
import * as f09 from "./lib/f09.mjs"
import * as f10 from "./lib/f10.mjs"
import * as f11 from "./lib/f11.mjs"
import * as f12 from "./lib/f12.mjs"
import * as f13 from "./lib/f13.mjs"
import * as f14 from "./lib/f14.mjs"
import * as f15 from "./lib/f15.mjs"
import * as f16 from "./lib/f16.mjs"

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

check(f01.addRange, "f01 addRange", [5], 15)
check(f01.addRange, "f01 addRange", [10], 55)
check(f02.isEven, "f02 isEven", [4], true)
check(f02.isEven, "f02 isEven", [7], false)
check(f02.isEven, "f02 isEven", [0], true)
check(f03.clamp01, "f03 clamp01", [0.5], 0.5)
check(f03.clamp01, "f03 clamp01", [-0.2], 0)
check(f03.clamp01, "f03 clamp01", [1.2], 1)
check(f04.avg, "f04 avg", [[2,4]], 3)
check(f04.avg, "f04 avg", [[1,2,3]], 2)
check(f05.round2, "f05 round2", [2.236], 2.24)
check(f05.round2, "f05 round2", [5.6789], 5.68)
check(f06.uniqueCount, "f06 uniqueCount", [[1,1,2]], 2)
check(f06.uniqueCount, "f06 uniqueCount", [[3,3,3,3]], 1)
check(f07.reverseWords, "f07 reverseWords", ["a b c"], "c b a")
check(f07.reverseWords, "f07 reverseWords", ["hello world"], "world hello")
check(f08.isPrime, "f08 isPrime", [2], true)
check(f08.isPrime, "f08 isPrime", [4], false)
check(f08.isPrime, "f08 isPrime", [9], false)
check(f08.isPrime, "f08 isPrime", [25], false)
check(f09.titleCase, "f09 titleCase", ["hello world"], "Hello world")
check(f09.titleCase, "f09 titleCase", ["HELLO"], "Hello")
check(f10.sumEvens, "f10 sumEvens", [[1,2,3,4]], 6)
check(f10.sumEvens, "f10 sumEvens", [[5,7]], 0)
check(f11.countVowels, "f11 countVowels", ["orange"], 3)
check(f11.countVowels, "f11 countVowels", ["sky"], 0)
check(f12.gcd, "f12 gcd", [[12,18]], 6)
check(f12.gcd, "f12 gcd", [[9,12]], 3)
check(f13.factorial, "f13 factorial", [5], 120)
check(f13.factorial, "f13 factorial", [0], 1)
check(f13.factorial, "f13 factorial", [3], 6)
check(f14.binarySearch, "f14 binarySearch", [{"arr":[1,3,5,7],"target":7}], 3)
check(f14.binarySearch, "f14 binarySearch", [{"arr":[2,4,6],"target":4}], 1)
check(f14.binarySearch, "f14 binarySearch", [{"arr":[1,2],"target":9}], -1)
check(f15.dedupe, "f15 dedupe", [[1,2,2,3]], [1,2,3])
check(f15.dedupe, "f15 dedupe", [[7]], [7])
check(f16.minMax, "f16 minMax", [[3,1,2]], [1,3])
check(f16.minMax, "f16 minMax", [[5,5]], [5,5])
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
