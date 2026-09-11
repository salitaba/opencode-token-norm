// rangeExclusive(q) — integers q.start..q.end-1
export function rangeExclusive(q) {
  const out = []
  for (let i = q.start; i <= q.end; i++) out.push(i)
  return out
}
