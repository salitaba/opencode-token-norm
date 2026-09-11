// interleave(a, b) — alternate values, extras appended in order
export function interleave(a, b) {
  const out = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (i < b.length) out.push(b[i])
    if (i < a.length) out.push(a[i])
  }
  return out
}
