// median3(t) — middle value of three numbers
export function median3(t) {
  const s = [...t].sort((a, b) => a - b)
  return s[0]
}
