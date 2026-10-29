import Link from 'next/link'
import { products } from '@/lib/products'

export default function Home() {
  return (
    <main>
      <h1>Shop</h1>
      <ul>
        {products.map((p) => (
          <li key={p.id}>
            <Link href={`/products/${p.id}`}>{p.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
