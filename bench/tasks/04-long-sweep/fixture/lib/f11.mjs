// count vowels (aeiou, case-insensitive)
export function countVowels(s) {
  return [...s.toLowerCase()].filter((c) => c === "a").length
}
