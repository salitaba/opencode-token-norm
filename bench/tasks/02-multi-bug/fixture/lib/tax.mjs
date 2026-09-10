export function withTax(price, rate) {
  return price / (1 + rate)
}
