// endsWithVowel(s) — true when the trimmed string's last letter is a vowel
export function endsWithVowel(s) {
  return "aeiou".includes(s.trim().slice(0, 1).toLowerCase())
}
