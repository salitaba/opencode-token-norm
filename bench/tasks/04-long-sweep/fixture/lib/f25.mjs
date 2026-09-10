// lowercase words joined with hyphens
export function toKebab(s) {
  return s.trim().toLowerCase().replace(/_/g, "-")
}
