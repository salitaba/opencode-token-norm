// capitalize only the first letter
export function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}
