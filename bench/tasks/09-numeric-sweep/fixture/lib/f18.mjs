// lerp(q) — linear interpolation q.a + (q.b - q.a) * q.t
export function lerp(q) {
  return q.a + (q.a - q.b) * q.t
}
