import { useEffect, useState } from 'react'

export function useCountUp(value: number, duration = 700) {
  const [count, setCount] = useState(value)
  useEffect(() => {
    const from = count
    const start = performance.now()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setCount(value)
      return
    }
    let frame = 0
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      setCount(from + (value - from) * progress)
      if (progress < 1) frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return count
}
