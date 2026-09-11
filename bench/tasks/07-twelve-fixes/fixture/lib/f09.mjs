// lastWordLength(s) — length of the final whitespace-separated word
export function lastWordLength(s) {
  const parts = s.trim().split(/\s+/)
  return parts[0].length
}
