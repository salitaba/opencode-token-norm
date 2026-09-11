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

check(m1.firstChar, "firstChar", ["abc"], "a")
check(m1.firstChar, "firstChar", [""], "")
check(m2.lastChar, "lastChar", ["abc"], "c")
check(m2.lastChar, "lastChar", [""], "")
check(m3.stringLength, "stringLength", [" a "], 3)
check(m3.stringLength, "stringLength", ["abc"], 3)
check(m4.isUppercase, "isUppercase", ["abc"], false)
check(m4.isUppercase, "isUppercase", ["ABC"], true)
check(m5.containsSub, "containsSub", [{"s":"banana","sub":"nan"}], true)
check(m5.containsSub, "containsSub", [{"s":"ab","sub":"abc"}], false)
check(m6.startsWithPrefix, "startsWithPrefix", [{"s":"hello","p":"he"}], true)
check(m6.startsWithPrefix, "startsWithPrefix", [{"s":"hello","p":"lo"}], false)
check(m7.endsWithSuffix, "endsWithSuffix", [{"s":"hello","p":"lo"}], true)
check(m7.endsWithSuffix, "endsWithSuffix", [{"s":"hello","p":"he"}], false)
check(m8.removeSpaces, "removeSpaces", ["a b"], "ab")
check(m8.removeSpaces, "removeSpaces", ["a  b"], "ab")
check(m9.countSpaces, "countSpaces", ["a b c"], 2)
check(m9.countSpaces, "countSpaces", ["abc"], 0)
check(m10.replaceAllChar, "replaceAllChar", [{"s":"a-a-a","from":"-","to":"_"}], "a_a_a")
check(m10.replaceAllChar, "replaceAllChar", [{"s":"xyx","from":"x","to":"z"}], "zyz")
check(m11.firstWord, "firstWord", ["one two"], "one")
check(m11.firstWord, "firstWord", ["solo"], "solo")
check(m12.wordCount, "wordCount", ["a  b"], 2)
check(m12.wordCount, "wordCount", ["solo"], 1)
check(m13.longestWord, "longestWord", ["cat horse dog"], "horse")
check(m13.longestWord, "longestWord", ["a bb ccc"], "ccc")
check(m14.shortestWord, "shortestWord", ["cat horse dog"], "cat")
check(m14.shortestWord, "shortestWord", ["aa b ccc"], "b")
check(m15.capitalizeWords, "capitalizeWords", ["hello world"], "Hello World")
check(m15.capitalizeWords, "capitalizeWords", ["a b"], "A B")
check(m16.maskLast, "maskLast", ["abc"], "ab*")
check(m16.maskLast, "maskLast", ["a"], "*")
check(m17.appendChar, "appendChar", [{"s":"ab","ch":"!"}], "ab!")
check(m17.appendChar, "appendChar", [{"s":"","ch":"x"}], "x")
check(m18.prependChar, "prependChar", [{"s":"ab","ch":"!"}], "!ab")
check(m18.prependChar, "prependChar", [{"s":"","ch":"x"}], "x")
check(m19.truncateTo, "truncateTo", [{"s":"abcdef","n":3}], "abc")
check(m19.truncateTo, "truncateTo", [{"s":"ab","n":5}], "ab")
check(m20.padRight, "padRight", [{"s":"ab","n":4}], "ab--")
check(m20.padRight, "padRight", [{"s":"abcd","n":2}], "abcd")
check(m21.indexOfChar, "indexOfChar", [{"s":"banana","ch":"a"}], 1)
check(m21.indexOfChar, "indexOfChar", [{"s":"abc","ch":"z"}], -1)
check(m22.lastIndexOfChar, "lastIndexOfChar", [{"s":"banana","ch":"a"}], 5)
check(m22.lastIndexOfChar, "lastIndexOfChar", [{"s":"abc","ch":"z"}], -1)
check(m23.consonantCount, "consonantCount", ["orange"], 3)
check(m23.consonantCount, "consonantCount", ["sky"], 3)
check(m23.consonantCount, "consonantCount", ["aeiou"], 0)
check(m24.isAllDigits, "isAllDigits", ["123"], true)
check(m24.isAllDigits, "isAllDigits", [""], false)
check(m24.isAllDigits, "isAllDigits", ["12a"], false)
check(m25.removeVowels, "removeVowels", ["banana"], "bnn")
check(m25.removeVowels, "removeVowels", ["aeiou"], "")
check(m26.duplicateChars, "duplicateChars", ["ab"], "aabb")
check(m26.duplicateChars, "duplicateChars", [""], "")
check(m27.reverseString, "reverseString", ["abc"], "cba")
check(m27.reverseString, "reverseString", ["ab"], "ba")
check(m28.swapEnds, "swapEnds", ["abc"], "cba")
check(m28.swapEnds, "swapEnds", ["ab"], "ba")
check(m28.swapEnds, "swapEnds", ["a"], "a")
check(m29.middleChar, "middleChar", ["abc"], "b")
check(m29.middleChar, "middleChar", ["abcd"], "b")
check(m29.middleChar, "middleChar", ["ab"], "a")
check(m30.shout, "shout", ["hi"], "HI!")
check(m30.shout, "shout", ["abc"], "ABC!")
console.log(failed ? `${failed} case(s) failed` : "all passed")
process.exit(failed ? 1 : 0)
