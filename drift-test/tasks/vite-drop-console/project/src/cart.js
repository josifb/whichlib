export function cartTotal(items) {
  let total = 0
  for (const item of items) {
    console.debug('[cart] line', item.sku, item.price * item.quantity)
    total += item.price * item.quantity
  }
  return total
}
