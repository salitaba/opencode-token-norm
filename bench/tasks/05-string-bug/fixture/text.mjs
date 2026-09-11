// slugify(s) — lowercase words joined by hyphens
export function slugify(s) {
  return s.trim().toLowerCase().replace(/ /g, "_")
}

// truncate(s, n) — s unchanged when short, else first n chars plus ...
export function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n) + "..."
}
