// median(nums) — middle value; even length averages the two middle values
export function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid] + s[mid]) / 2
}
