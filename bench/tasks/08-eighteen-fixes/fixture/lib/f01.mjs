// countWords(s) — whitespace-separated word count, 0 for blank input
export function countWords(s) {
  return s.trim() ? s.trim().split(" ").length : 0
}
