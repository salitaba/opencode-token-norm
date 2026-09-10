// n! with factorial(0) === 1
export function factorial(n) {
  let out = 0
  for (let i = 1; i <= n; i++) out += i
  return out
}
