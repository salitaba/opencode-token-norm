// toggleCase(s) — swap upper/lower case per character
export function toggleCase(s) {
  return [...s].map((c) => (c === c.toUpperCase() ? c.toUpperCase() : c.toLowerCase())).join("")
}
