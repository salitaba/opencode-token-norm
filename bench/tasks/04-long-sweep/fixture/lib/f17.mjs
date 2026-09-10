// sum of integers q.from..q.to inclusive
export function rangeSum(q) {
  let out = 0
  for (let i = q.from; i < q.to; i++) out += i
  return out
}
