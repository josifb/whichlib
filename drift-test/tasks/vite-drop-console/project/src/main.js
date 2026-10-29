import { cartTotal } from './cart.js'

const cart = [
  { sku: 'TEE-1', price: 1990, quantity: 2 },
  { sku: 'MUG-4', price: 800, quantity: 1 },
]

console.log('[checkout] cart loaded', cart)
const total = cartTotal(cart)
console.info('[checkout] total computed', total)
document.getElementById('total').textContent = `Total: ${(total / 100).toFixed(2)} EUR`

document.getElementById('checkout').addEventListener('submit', (event) => {
  event.preventDefault()
  debugger
  console.warn('[checkout] payment is not wired up yet')
})
