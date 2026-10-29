import { createRoot, hydrateRoot } from 'react-dom/client'
import { App } from './App.js'

export function mountApp(container: HTMLElement): () => void {
  const root = createRoot(container)
  root.render(<App />)
  return () => root.unmount()
}

export function hydrateApp(container: HTMLElement): () => void {
  const root = hydrateRoot(container, <App />)
  return () => root.unmount()
}
