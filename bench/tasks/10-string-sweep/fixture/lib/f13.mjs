// longestWord(s) — longest whitespace-separated word
export function longestWord(s) {
  return s.trim().split(/\s+/).reduce((a, b) => (b.length < a.length ? b : a))
}
