import { useState } from 'react'

export function App() {
  const [count, setCount] = useState(0)
  return (
    <section className="widget">
      <h1>Hello from the widget</h1>
      <button type="button" onClick={() => setCount(count + 1)}>
        Clicked {count} times
      </button>
    </section>
  )
}
