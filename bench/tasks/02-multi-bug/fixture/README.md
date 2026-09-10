# checkout

- `lineTotal(item)` — price times quantity for one cart item.
- `cartTotal(items)` — sum of `lineTotal` over all items; `0` for an empty cart.
- `applyDiscount(price, percent)` — price after a whole-number percent discount.
  `percent` is in percentage points: `10` means 10% off, `0` means no change.
- `withTax(price, rate)` — price plus tax, where `rate` is a decimal fraction:
  `0.1` means +10%.
