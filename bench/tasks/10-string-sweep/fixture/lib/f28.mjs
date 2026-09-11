// swapEnds(s) — first and last characters swapped
export function swapEnds(s) {
  return s.length < 2 ? s : s[0] + s.slice(1, -1) + s[s.length - 1]
}
