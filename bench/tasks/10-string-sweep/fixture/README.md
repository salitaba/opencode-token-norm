# checkout: thirty independent bugs

Each file exports one function with one bug. The contract:

- `f01.firstChar(s) — first character, empty string for input ""`
- `f02.lastChar(s) — last character, empty string for input ""`
- `f03.stringLength(s) — length including surrounding spaces`
- `f04.isUppercase(s) — true when s equals its uppercase form`
- `f05.containsSub(q) — true when q.s contains q.sub`
- `f06.startsWithPrefix(q) — true when q.s starts with q.p`
- `f07.endsWithSuffix(q) — true when q.s ends with q.p`
- `f08.removeSpaces(s) — s without spaces`
- `f09.countSpaces(s) — number of space characters`
- `f10.replaceAllChar(q) — every q.from in q.s replaced by q.to`
- `f11.firstWord(s) — first whitespace-separated word`
- `f12.wordCount(s) — whitespace-separated word count, 0 for blank input`
- `f13.longestWord(s) — longest whitespace-separated word`
- `f14.shortestWord(s) — shortest whitespace-separated word`
- `f15.capitalizeWords(s) — capitalize each word, lowercase the rest`
- `f16.maskLast(s) — replace the last character with *`
- `f17.appendChar(q) — q.s followed by q.ch`
- `f18.prependChar(q) — q.ch followed by q.s`
- `f19.truncateTo(q) — first q.n characters of q.s`
- `f20.padRight(q) — q.s padded with - on the right to length q.n`
- `f21.indexOfChar(q) — first index of q.ch in q.s, else -1`
- `f22.lastIndexOfChar(q) — last index of q.ch in q.s, else -1`
- `f23.consonantCount(s) — count of letters that are not vowels`
- `f24.isAllDigits(s) — true when s is one or more digits`
- `f25.removeVowels(s) — remove all vowels, case-insensitive`
- `f26.duplicateChars(s) — each character repeated twice`
- `f27.reverseString(s) — characters in reverse order`
- `f28.swapEnds(s) — first and last characters swapped`
- `f29.middleChar(s) — lower middle character`
- `f30.shout(s) — s uppercased with a trailing !`
