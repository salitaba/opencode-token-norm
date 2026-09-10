export function lineTotal(item) {
  return item.price
}

export function cartTotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0)
}
