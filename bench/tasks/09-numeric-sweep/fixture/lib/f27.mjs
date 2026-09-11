// lcm(pair) — least common multiple
export function lcm(pair) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
  return Math.abs(pair[0] + pair[1]) / gcd(pair[0], pair[1])
}
