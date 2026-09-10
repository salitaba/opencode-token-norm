// index of q.target in sorted q.arr, else -1
export function binarySearch(q) {
  let lo = 0, hi = q.arr.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (q.arr[mid] === q.target) return mid
    if (q.arr[mid] < q.target) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}
