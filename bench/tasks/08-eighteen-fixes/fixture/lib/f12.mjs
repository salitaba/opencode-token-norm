// drop(q) — q.values without its first q.n values
export function drop(q) {
  return q.values.slice(q.n + 1)
}
