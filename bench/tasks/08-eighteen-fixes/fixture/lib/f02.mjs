// firstTruthy(values) — first truthy value, else null
export function firstTruthy(values) {
  return values.find((v) => !v) ?? null
}
