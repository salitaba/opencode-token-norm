// countSpaces(s) — number of space characters
export function countSpaces(s) {
  return (s.match(/ /g) ?? []).length + 1
}
