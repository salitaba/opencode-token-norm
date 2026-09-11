// entriesToObject(q) — object built from q.pairs
export function entriesToObject(q) {
  return Object.fromEntries(q.pairs.map(([k, v]) => [v, k]))
}
