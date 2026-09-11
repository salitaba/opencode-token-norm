// pairwiseSum(nums) — sums of adjacent pairs
export function pairwiseSum(nums) {
  return nums.slice(2).map((v, i) => v + nums[i])
}
