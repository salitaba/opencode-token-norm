// countDown(n) — [n..1]
export function countDown(n) {
  return Array.from({ length: n }, (_, i) => n - i - 1)
}
