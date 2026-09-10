// sum of the even values
export function sumEvens(nums) {
  return nums.filter((x) => x % 2 === 1).reduce((a, b) => a + b, 0)
}
