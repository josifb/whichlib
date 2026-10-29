import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { formatPrice, getProduct, products } from '@/lib/products'

type Props = { params: { id: string } }

export function generateStaticParams() {
  return products.map((p) => ({ id: p.id }))
}

export function generateMetadata({ params }: Props): Metadata {
  const product = getProduct(params.id)
  return { title: product ? `${product.name} | Shop` : 'Not found | Shop' }
}

export default function ProductPage({ params }: Props) {
  const product = getProduct(params.id)
  if (!product) notFound()
  return (
    <main>
      <h1>{product.name}</h1>
      <p>{formatPrice(product.priceCents)}</p>
    </main>
  )
}
