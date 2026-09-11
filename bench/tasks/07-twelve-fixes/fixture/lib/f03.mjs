// sumTo(n) — sum of 1..n inclusive
export function sumTo(n) {
  let out = 0
  for (let i = 1; i < n; i++) out += i
  return out
}
