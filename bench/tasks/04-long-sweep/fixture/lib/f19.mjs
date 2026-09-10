// split q.arr into arrays of at most q.size
export function chunk(q) {
  const out = []
  for (let i = 0; i < q.arr.length; i += q.size) out.push(q.arr.slice(i, i + q.size - 1))
  return out
}
