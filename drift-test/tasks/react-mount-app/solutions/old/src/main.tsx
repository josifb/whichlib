import ReactDOM from 'react-dom'
import { App } from './App.js'

export function mountApp(container: HTMLElement): () => void {
  ReactDOM.render(<App />, container)
  return () => {
    ReactDOM.unmountComponentAtNode(container)
  }
}

export function hydrateApp(container: HTMLElement): () => void {
  ReactDOM.hydrate(<App />, container)
  return () => {
    ReactDOM.unmountComponentAtNode(container)
  }
}
