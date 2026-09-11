// fizzValue(n) — Fizz/Buzz/FizzBuzz, else String(n)
export function fizzValue(n) {
  if (n % 15 === 0) return "FizzBuzz"
  if (n % 5 === 0) return "Fizz"
  if (n % 3 === 0) return "Buzz"
  return String(n)
}
