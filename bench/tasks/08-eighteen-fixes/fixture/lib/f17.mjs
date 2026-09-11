// maxByLength(q) — longest word, first one on ties
export function maxByLength(q) {
  return q.words.reduce((a, b) => (b.length >= a.length ? b : a))
}
