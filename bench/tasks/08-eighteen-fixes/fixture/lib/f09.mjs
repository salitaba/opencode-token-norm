// anyOdd(nums) — true when at least one value is odd
export function anyOdd(nums) {
  return nums.every((n) => Math.abs(n % 2) === 1)
}
