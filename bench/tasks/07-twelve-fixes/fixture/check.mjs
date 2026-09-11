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

check(m1.capitalize, "capitalize", ["hello"], "Hello")
check(m1.capitalize, "capitalize", ["hELLO"], "HELLO")
check(m1.capitalize, "capitalize", [" x"], "X")
check(m2.indexOfMax, "indexOfMax", [[3,1,3]], 0)
check(m2.indexOfMax, "indexOfMax", [[5]], 0)
check(m3.sumTo, "sumTo", [5], 15)
check(m3.sumTo, "sumTo", [1], 1)
check(m4.repeatStr, "repeatStr", [{"s":"ab","n":3}], "ababab")
check(m4.repeatStr, "repeatStr", [{"s":"x","n":0}], "")
check(m5.countOccurrences, "countOccurrences", [{"s":"banana","sub":"an"}], 2)
check(m5.countOccurrences, "countOccurrences", [{"s":"aaa","sub":"aa"}], 1)
check(m6.removeFalsy, "removeFalsy", [[0,1,"",2,null]], [1,2])
check(m6.removeFalsy, "removeFalsy", [[false,"a"]], ["a"])
check(m7.endsWithVowel, "endsWithVowel", ["banana"], true)
check(m7.endsWithVowel, "endsWithVowel", ["sky"], false)
check(m7.endsWithVowel, "endsWithVowel", ["tree"], true)
check(m8.powInt, "powInt", [{"base":2,"exp":5}], 32)
check(m8.powInt, "powInt", [{"base":3,"exp":0}], 1)
check(m9.lastWordLength, "lastWordLength", ["one two three"], 5)
check(m9.lastWordLength, "lastWordLength", ["solo"], 4)
check(m10.rangeExclusive, "rangeExclusive", [{"start":1,"end":4}], [1,2,3])
check(m10.rangeExclusive, "rangeExclusive", [{"start":2,"end":2}], [])
check(m11.zip, "zip", [[1,2], ["x","y","z"]], [[1,"x"],[2,"y"]])
check(m11.zip, "zip", [[1], []], [])
check(m12.toggleCase, "toggleCase", ["aB"], "Ab")
check(m12.toggleCase, "toggleCase", ["Hello"], "hELLO")
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
