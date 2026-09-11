// evensUpTo(n) — even numbers 2..n
export function evensUpTo(n) {
  return Array.from({ length: Math.floor(n / 2) }, (_, i) => i * 2)
}
