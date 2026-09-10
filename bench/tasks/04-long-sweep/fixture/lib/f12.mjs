// greatest common divisor of pair[0], pair[1]
export function gcd(pair) {
  let [a, b] = pair
  if (b === 0) return 0
  return a % b
}
