import { useState } from 'react'
import { createRoot } from 'react-dom/client'

function Shop() {
  const [items, setItems] = useState(0)
  return (
    <main>
      <h1>Shop ready</h1>
      <button onClick={() => setItems(items + 1)}>Add to cart ({items})</button>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<Shop />)
