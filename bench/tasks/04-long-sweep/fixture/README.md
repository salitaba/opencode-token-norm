# checkout: thirty independent bugs

Each file under `lib/` exports one function with one bug. The contract:

- `f01.addRange(n)` — sum of the integers 1..n
- `f02.isEven(n)` — true when n is even
- `f03.clamp01(v)` — clamp v into [0, 1]
- `f04.avg(nums)` — arithmetic mean of an array
- `f05.round2(x)` — round to 2 decimal places
- `f06.uniqueCount(values)` — number of distinct values
- `f07.reverseWords(s)` — reverse word order
- `f08.isPrime(n)` — true when n is prime
- `f09.titleCase(s)` — capitalize only the first letter
- `f10.sumEvens(nums)` — sum of the even values
- `f11.countVowels(s)` — count vowels (aeiou, case-insensitive)
- `f12.gcd(pair)` — greatest common divisor of pair[0], pair[1]
- `f13.factorial(n)` — n! with factorial(0) === 1
- `f14.binarySearch(q)` — index of q.target in sorted q.arr, else -1
- `f15.dedupe(values)` — distinct values, order preserved
- `f16.minMax(nums)` — [min, max] of nums
- `f17.rangeSum(q)` — sum of integers q.from..q.to inclusive
- `f18.isPalindrome(s)` — palindrome ignoring case
- `f19.chunk(q)` — split q.arr into arrays of at most q.size
- `f20.fib(n)` — fib(n) with fib(0) === 0 and fib(1) === 1
- `f21.countChar(q)` — occurrences of q.ch in q.s
- `f22.flattenOne(nums)` — one-level flatten
- `f23.sign(n)` — -1, 0 or 1
- `f24.absolute(n)` — absolute value
- `f25.toKebab(s)` — lowercase words joined with hyphens
- `f26.sumDigits(n)` — sum of n's decimal digits
- `f27.maxOf(nums)` — largest value
- `f28.startsWithVowel(s)` — first letter is a vowel
- `f29.wrap(q)` — q.value modulo q.limit
- `f30.lastWord(s)` — final word of s
