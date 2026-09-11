import assert from "node:assert/strict"
import * as m1 from "./lib/f01.mjs"
import * as m2 from "./lib/f02.mjs"
import * as m3 from "./lib/f03.mjs"
import * as m4 from "./lib/f04.mjs"
import * as m5 from "./lib/f05.mjs"
import * as m6 from "./lib/f06.mjs"
import * as m7 from "./lib/f07.mjs"
import * as m8 from "./lib/f08.mjs"
import * as m9 from "./lib/f09.mjs"
import * as m10 from "./lib/f10.mjs"
import * as m11 from "./lib/f11.mjs"
import * as m12 from "./lib/f12.mjs"
import * as m13 from "./lib/f13.mjs"
import * as m14 from "./lib/f14.mjs"
import * as m15 from "./lib/f15.mjs"
import * as m16 from "./lib/f16.mjs"
import * as m17 from "./lib/f17.mjs"
import * as m18 from "./lib/f18.mjs"

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

check(m1.countWords, "countWords", ["a  b"], 2)
check(m1.countWords, "countWords", ["solo"], 1)
check(m2.firstTruthy, "firstTruthy", [[0,"",false,"x"]], "x")
check(m2.firstTruthy, "firstTruthy", [[null,0]], null)
check(m3.arrayMax, "arrayMax", [[3,9,2]], 9)
check(m3.arrayMax, "arrayMax", [[-1]], -1)
check(m4.arrayMin, "arrayMin", [[-1,-5]], -5)
check(m4.arrayMin, "arrayMin", [[7]], 7)
check(m5.arraySum, "arraySum", [[1,2,3]], 6)
check(m5.arraySum, "arraySum", [[]], 0)
check(m6.productAll, "productAll", [[2,3,4]], 24)
check(m6.productAll, "productAll", [[]], 1)
check(m7.countTruthy, "countTruthy", [[0,1,2,"",3]], 3)
check(m7.countTruthy, "countTruthy", [[0,false]], 0)
check(m8.allEven, "allEven", [[2,4,6]], true)
check(m8.allEven, "allEven", [[2,3]], false)
check(m9.anyOdd, "anyOdd", [[2,4]], false)
check(m9.anyOdd, "anyOdd", [[1,2]], true)
check(m10.indexOfMin, "indexOfMin", [[3,1,2]], 1)
check(m10.indexOfMin, "indexOfMin", [[5,4,4]], 1)
check(m11.take, "take", [{"values":[1,2,3],"n":2}], [1,2])
check(m11.take, "take", [{"values":[1],"n":0}], [])
check(m12.drop, "drop", [{"values":[1,2,3],"n":1}], [2,3])
check(m12.drop, "drop", [{"values":[1,2],"n":0}], [1,2])
check(m13.pairwiseSum, "pairwiseSum", [[1,2,3,4]], [3,5,7])
check(m13.pairwiseSum, "pairwiseSum", [[5,5]], [10])
check(m14.interleave, "interleave", [[1,2], ["a"]], [1,"a",2])
check(m14.interleave, "interleave", [[], [1,2]], [1,2])
check(m15.entriesToObject, "entriesToObject", [{"pairs":[["a",1],["b",2]]}], {"a":1,"b":2})
check(m15.entriesToObject, "entriesToObject", [{"pairs":[["x",0]]}], {"x":0})
check(m16.repeatArray, "repeatArray", [{"values":[1,2],"n":3}], [1,2,1,2,1,2])
check(m16.repeatArray, "repeatArray", [{"values":[9],"n":1}], [9])
check(m17.maxByLength, "maxByLength", [{"words":["a","bb","cc"]}], "bb")
check(m17.maxByLength, "maxByLength", [{"words":["solo"]}], "solo")
check(m18.rotateLeft, "rotateLeft", [[1,2,3]], [2,3,1])
check(m18.rotateLeft, "rotateLeft", [[7]], [7])
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
