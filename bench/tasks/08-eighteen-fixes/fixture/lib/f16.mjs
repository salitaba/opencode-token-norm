// repeatArray(q) — q.values repeated q.n times
export function repeatArray(q) {
  const out = []
  for (let i = 0; i < q.n - 1; i++) out.push(...q.values)
  return out
}
