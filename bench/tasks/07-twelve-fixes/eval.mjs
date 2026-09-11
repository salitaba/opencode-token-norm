import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import { join } from "node:path"

const ws = process.argv[2]
const m1 = await import(pathToFileURL(join(ws, "lib", "f01.mjs")).href)
const m2 = await import(pathToFileURL(join(ws, "lib", "f02.mjs")).href)
const m3 = await import(pathToFileURL(join(ws, "lib", "f03.mjs")).href)
const m4 = await import(pathToFileURL(join(ws, "lib", "f04.mjs")).href)
const m5 = await import(pathToFileURL(join(ws, "lib", "f05.mjs")).href)
const m6 = await import(pathToFileURL(join(ws, "lib", "f06.mjs")).href)
const m7 = await import(pathToFileURL(join(ws, "lib", "f07.mjs")).href)
const m8 = await import(pathToFileURL(join(ws, "lib", "f08.mjs")).href)
const m9 = await import(pathToFileURL(join(ws, "lib", "f09.mjs")).href)
const m10 = await import(pathToFileURL(join(ws, "lib", "f10.mjs")).href)
const m11 = await import(pathToFileURL(join(ws, "lib", "f11.mjs")).href)
const m12 = await import(pathToFileURL(join(ws, "lib", "f12.mjs")).href)

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
