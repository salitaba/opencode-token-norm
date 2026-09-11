// oddsUpTo(n) — odd numbers 1..n
export function oddsUpTo(n) {
  return Array.from({ length: Math.ceil(n / 2) }, (_, i) => i * 2)
}
