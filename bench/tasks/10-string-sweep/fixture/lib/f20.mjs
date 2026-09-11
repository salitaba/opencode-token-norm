// padRight(q) — q.s padded with - on the right to length q.n
export function padRight(q) {
  return q.s.padStart(q.n, "-")
}
