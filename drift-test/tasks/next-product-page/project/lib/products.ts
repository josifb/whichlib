export type Product = { id: string; name: string; priceCents: number }

export const products: Product[] = [
  { id: 'lamp', name: 'Desk lamp', priceCents: 3900 },
  { id: 'chair', name: 'Office chair', priceCents: 18900 },
  { id: 'mug', name: 'Coffee mug', priceCents: 1200 },
]

export function getProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id)
}

export function formatPrice(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`
}
