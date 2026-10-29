// A browser-like global environment for rendering with react-dom in Node. Import it first.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
const g = globalThis as any
g.window = dom.window
g.document = dom.window.document
g.HTMLElement = dom.window.HTMLElement
g.Element = dom.window.Element
g.Node = dom.window.Node
g.MouseEvent = dom.window.MouseEvent
g.IS_REACT_ACT_ENVIRONMENT = true

export const window = dom.window
