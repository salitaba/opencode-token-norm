// productAll(nums) — product; 1 for an empty array
export function productAll(nums) {
  return nums.reduce((a, b) => a + b, 1)
}
