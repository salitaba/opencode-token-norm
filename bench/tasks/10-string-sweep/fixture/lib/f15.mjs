// capitalizeWords(s) — capitalize each word, lowercase the rest
export function capitalizeWords(s) {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.toUpperCase())
    .join(" ")
}
