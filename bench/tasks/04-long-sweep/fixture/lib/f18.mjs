// palindrome ignoring case
export function isPalindrome(s) {
  return s === [...s].reverse().join("")
}
