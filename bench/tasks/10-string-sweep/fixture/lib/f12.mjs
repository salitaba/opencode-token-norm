// wordCount(s) — whitespace-separated word count, 0 for blank input
export function wordCount(s) {
  return s.trim() ? s.trim().split(" ").length : 0
}
