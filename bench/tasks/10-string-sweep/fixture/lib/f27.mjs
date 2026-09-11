// reverseString(s) — characters in reverse order
export function reverseString(s) {
  return [...s].sort().join("")
}
