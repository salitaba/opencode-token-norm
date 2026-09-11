// powInt(q) — q.base raised to the integer q.exp
export function powInt(q) {
  let out = 0
  for (let i = 0; i < q.exp; i++) out *= q.base
  return out
}
