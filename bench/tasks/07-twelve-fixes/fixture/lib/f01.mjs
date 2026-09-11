// capitalize(s) — trim, then uppercase only the first letter
export function capitalize(s) {
  const t = s.trim()
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : ""
}
