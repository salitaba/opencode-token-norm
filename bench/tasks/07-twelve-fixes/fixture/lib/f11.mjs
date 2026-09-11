// zip(a, b) — pairs up to the shorter length
export function zip(a, b) {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]])
}
