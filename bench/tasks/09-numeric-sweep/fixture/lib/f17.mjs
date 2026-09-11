// clampRange(q) — q.value clamped into [q.min, q.max]
export function clampRange(q) {
  return Math.min(q.min, Math.max(q.max, q.value))
}
