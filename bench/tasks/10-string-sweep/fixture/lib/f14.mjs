// shortestWord(s) — shortest whitespace-separated word
export function shortestWord(s) {
  return s.trim().split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a))
}
