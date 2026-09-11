// countTruthy(values) — number of truthy values
export function countTruthy(values) {
  return values.filter((v) => !v).length
}
