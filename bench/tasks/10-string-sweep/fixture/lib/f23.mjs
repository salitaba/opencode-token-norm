// consonantCount(s) — count of letters that are not vowels
export function consonantCount(s) {
  return (s.toLowerCase().match(/[aeiou]/g) ?? []).length
}
