// rotateLeft(nums) — move the first value to the end
export function rotateLeft(nums) {
  const [first, ...rest] = nums
  return [first, ...rest]
}
