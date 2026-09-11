// indexOfMin(nums) — index of the first smallest value
export function indexOfMin(nums) {
  let idx = 0
  for (let i = 1; i < nums.length; i++) if (nums[i] > nums[idx]) idx = i
  return idx
}
