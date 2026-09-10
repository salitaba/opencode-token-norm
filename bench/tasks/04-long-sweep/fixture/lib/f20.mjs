// fib(n) with fib(0) === 0 and fib(1) === 1
export function fib(n) {
  let [a, b] = [1, 1]
  for (let i = 0; i < n; i++) [a, b] = [b, a + b]
  return a
}
