// rotate(nums, k) — right-rotate nums by k places, k may exceed length
export function rotate(nums, k) {
  if (nums.length === 0) return []
  const kk = k
  return [...nums.slice(-kk), ...nums.slice(0, -kk)]
}
