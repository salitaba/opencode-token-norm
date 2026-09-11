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
import * as m19 from "./lib/f19.mjs"
import * as m20 from "./lib/f20.mjs"
import * as m21 from "./lib/f21.mjs"
import * as m22 from "./lib/f22.mjs"
import * as m23 from "./lib/f23.mjs"
import * as m24 from "./lib/f24.mjs"
import * as m25 from "./lib/f25.mjs"
import * as m26 from "./lib/f26.mjs"
import * as m27 from "./lib/f27.mjs"
import * as m28 from "./lib/f28.mjs"
import * as m29 from "./lib/f29.mjs"
import * as m30 from "./lib/f30.mjs"

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

check(m1.increment, "increment", [5], 6)
check(m1.increment, "increment", [0], 1)
check(m2.decrement, "decrement", [5], 4)
check(m2.decrement, "decrement", [0], -1)
check(m3.double, "double", [4], 8)
check(m3.double, "double", [-3], -6)
check(m4.triple, "triple", [4], 12)
check(m4.triple, "triple", [0], 0)
check(m5.square, "square", [5], 25)
check(m5.square, "square", [-3], 9)
check(m6.cube, "cube", [3], 27)
check(m6.cube, "cube", [-2], -8)
check(m7.isNegative, "isNegative", [0], false)
check(m7.isNegative, "isNegative", [-2], true)
check(m7.isNegative, "isNegative", [3], false)
check(m8.isZero, "isZero", [0], true)
check(m8.isZero, "isZero", [2], false)
check(m8.isZero, "isZero", [-3], false)
check(m9.max2, "max2", [[4,9]], 9)
check(m9.max2, "max2", [[-1,-5]], -1)
check(m10.min2, "min2", [[4,9]], 4)
check(m10.min2, "min2", [[-1,-5]], -5)
check(m11.sum3, "sum3", [[1,2,3]], 6)
check(m11.sum3, "sum3", [[0,0,0]], 0)
check(m12.product2, "product2", [[3,4]], 12)
check(m12.product2, "product2", [[0,5]], 0)
check(m13.remainder, "remainder", [[7,3]], 1)
check(m13.remainder, "remainder", [[9,4]], 1)
check(m14.floorDiv, "floorDiv", [[7,2]], 3)
check(m14.floorDiv, "floorDiv", [[10,4]], 2)
check(m15.isMultiple, "isMultiple", [{"a":3,"b":6}], false)
check(m15.isMultiple, "isMultiple", [{"a":6,"b":3}], true)
check(m16.median3, "median3", [[3,1,2]], 2)
check(m16.median3, "median3", [[5,1,9]], 5)
check(m17.clampRange, "clampRange", [{"value":7,"min":0,"max":5}], 5)
check(m17.clampRange, "clampRange", [{"value":-2,"min":0,"max":5}], 0)
check(m17.clampRange, "clampRange", [{"value":3,"min":0,"max":5}], 3)
check(m18.lerp, "lerp", [{"a":0,"b":10,"t":0.5}], 5)
check(m18.lerp, "lerp", [{"a":2,"b":4,"t":0.25}], 2.5)
check(m19.countUp, "countUp", [3], [1,2,3])
check(m19.countUp, "countUp", [1], [1])
check(m20.countDown, "countDown", [3], [3,2,1])
check(m20.countDown, "countDown", [1], [1])
check(m21.evensUpTo, "evensUpTo", [4], [2,4])
check(m21.evensUpTo, "evensUpTo", [1], [])
check(m22.oddsUpTo, "oddsUpTo", [5], [1,3,5])
check(m22.oddsUpTo, "oddsUpTo", [2], [1])
check(m23.fizzValue, "fizzValue", [3], "Fizz")
check(m23.fizzValue, "fizzValue", [5], "Buzz")
check(m23.fizzValue, "fizzValue", [15], "FizzBuzz")
check(m23.fizzValue, "fizzValue", [7], "7")
check(m24.digitCount, "digitCount", [123], 3)
check(m24.digitCount, "digitCount", [-12], 2)
check(m24.digitCount, "digitCount", [0], 1)
check(m25.reverseNumber, "reverseNumber", [123], 321)
check(m25.reverseNumber, "reverseNumber", [40], 4)
check(m26.isPerfectSquare, "isPerfectSquare", [9], true)
check(m26.isPerfectSquare, "isPerfectSquare", [10], false)
check(m26.isPerfectSquare, "isPerfectSquare", [0], true)
check(m27.lcm, "lcm", [[4,6]], 12)
check(m27.lcm, "lcm", [[3,5]], 15)
check(m28.averageTwo, "averageTwo", [[2,4]], 3)
check(m28.averageTwo, "averageTwo", [[1,2]], 1.5)
check(m29.percentOf, "percentOf", [{"value":80,"percent":25}], 20)
check(m29.percentOf, "percentOf", [{"value":50,"percent":10}], 5)
check(m30.roundUp, "roundUp", [3.2], 4)
check(m30.roundUp, "roundUp", [3], 3)
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
