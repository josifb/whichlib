import type { JSX } from 'react'
import { useStopwatch } from './useStopwatch.js'

export function Stopwatch(): JSX.Element {
  const { seconds, start, stop, reset } = useStopwatch()
  return (
    <div>
      <span data-testid="time">{seconds}s</span>
      <button type="button" onClick={start}>Start</button>
      <button type="button" onClick={stop}>Stop</button>
      <button type="button" onClick={reset}>Reset</button>
    </div>
  )
}
