import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { formatPrice, getProduct, products } from '@/lib/products'

export function generateStaticParams() {
  return products.map((p) => ({ id: p.id }))
}

export async function generateMetadata({ params }: PageProps<'/products/[id]'>): Promise<Metadata> {
  const { id } = await params
  const product = getProduct(id)
  return { title: product ? `${product.name} | Shop` : 'Not found | Shop' }
}

export default async function ProductPage({ params }: PageProps<'/products/[id]'>) {
  const { id } = await params
  const product = getProduct(id)
  if (!product) notFound()
  return (
    <main>
      <h1>{product.name}</h1>
      <p>{formatPrice(product.priceCents)}</p>
    </main>
  )
}
