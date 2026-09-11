# checkout: thirty independent bugs

Each file exports one function with one bug. The contract:

- `f01.increment(n) — n + 1`
- `f02.decrement(n) — n - 1`
- `f03.double(n) — n * 2`
- `f04.triple(n) — n * 3`
- `f05.square(n) — n * n`
- `f06.cube(n) — n * n * n`
- `f07.isNegative(n) — true when n < 0`
- `f08.isZero(n) — true when n === 0`
- `f09.max2(pair) — larger of pair[0], pair[1]`
- `f10.min2(pair) — smaller of pair[0], pair[1]`
- `f11.sum3(t) — t[0] + t[1] + t[2]`
- `f12.product2(pair) — pair[0] * pair[1]`
- `f13.remainder(pair) — pair[0] modulo pair[1]`
- `f14.floorDiv(pair) — floor(pair[0] / pair[1])`
- `f15.isMultiple(q) — true when q.a is a multiple of q.b`
- `f16.median3(t) — middle value of three numbers`
- `f17.clampRange(q) — q.value clamped into [q.min, q.max]`
- `f18.lerp(q) — linear interpolation q.a + (q.b - q.a) * q.t`
- `f19.countUp(n) — [1..n]`
- `f20.countDown(n) — [n..1]`
- `f21.evensUpTo(n) — even numbers 2..n`
- `f22.oddsUpTo(n) — odd numbers 1..n`
- `f23.fizzValue(n) — Fizz/Buzz/FizzBuzz, else String(n)`
- `f24.digitCount(n) — number of decimal digits of |n|`
- `f25.reverseNumber(n) — digits reversed`
- `f26.isPerfectSquare(n) — true when n is a perfect square`
- `f27.lcm(pair) — least common multiple`
- `f28.averageTwo(pair) — mean of pair[0], pair[1]`
- `f29.percentOf(q) — q.percent percent of q.value`
- `f30.roundUp(n) — smallest integer >= n`
