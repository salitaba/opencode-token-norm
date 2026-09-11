// firstWord(s) — first whitespace-separated word
export function firstWord(s) {
  return s.trim().split(/\s+/).pop()
}
