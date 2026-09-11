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
const m13 = await import(pathToFileURL(join(ws, "lib", "f13.mjs")).href)
const m14 = await import(pathToFileURL(join(ws, "lib", "f14.mjs")).href)
const m15 = await import(pathToFileURL(join(ws, "lib", "f15.mjs")).href)
const m16 = await import(pathToFileURL(join(ws, "lib", "f16.mjs")).href)
const m17 = await import(pathToFileURL(join(ws, "lib", "f17.mjs")).href)
const m18 = await import(pathToFileURL(join(ws, "lib", "f18.mjs")).href)

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
