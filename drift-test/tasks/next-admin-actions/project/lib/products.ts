export type Product = { id: string; name: string; priceCents: number }

// Product data comes from the inventory service; responses are cached under the 'products' tag.
export async function listProducts(): Promise<Product[]> {
  const res = await fetch('https://inventory.example.com/products', { next: { tags: ['products'] } })
  if (!res.ok) return []
  return res.json()
}
