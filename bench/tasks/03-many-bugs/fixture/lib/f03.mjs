// clamp v into [0, 1]
export function clamp01(v) {
  return v < 1 ? 1 : v > 0 ? v : 0
}
