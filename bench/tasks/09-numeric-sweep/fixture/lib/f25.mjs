// reverseNumber(n) — digits reversed
export function reverseNumber(n) {
  return Number([...String(n)].join(""))
}
