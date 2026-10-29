import { useCallback, useEffect, useRef, useState } from 'react'

export type Stopwatch = { seconds: number; running: boolean; start: () => void; stop: () => void; reset: () => void }

export function useStopwatch(): Stopwatch {
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<number>()

  const clear = useCallback(() => {
    window.clearInterval(intervalRef.current)
    intervalRef.current = undefined
  }, [])

  const start = useCallback(() => {
    if (intervalRef.current !== undefined) return
    intervalRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    setRunning(true)
  }, [])

  const stop = useCallback(() => {
    clear()
    setRunning(false)
  }, [clear])

  const reset = useCallback(() => {
    stop()
    setSeconds(0)
  }, [stop])

  useEffect(() => clear, [clear])

  return { seconds, running, start, stop, reset }
}
