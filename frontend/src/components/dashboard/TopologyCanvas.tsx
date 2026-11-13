import { useEffect, useRef } from 'react'
import type { Warehouse } from '../../types'

export function TopologyCanvas({ warehouses, onSelect }: { warehouses: Warehouse[]; onSelect: (hub: Warehouse) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    let frame = 0, tick = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const styles = getComputedStyle(document.documentElement)
    const lime = styles.getPropertyValue('--accent-ops-lime').trim()
    const warning = styles.getPropertyValue('--status-warning').trim()
    const border = styles.getPropertyValue('--border-ops').trim()
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = rect.width * ratio; canvas.height = rect.height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const width = rect.width, height = rect.height
      context.clearRect(0, 0, width, height)
      const points = warehouses.map((hub) => ({ hub, x: 30 + hub.coords[0] * (width - 60), y: 30 + hub.coords[1] * (height - 60) }))
      context.strokeStyle = border; context.lineWidth = 1
      points.forEach((point, index) => points.slice(index + 1).forEach((next) => {
        context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(next.x, next.y); context.stroke()
      }))
      points.forEach(({ hub, x, y }, index) => {
        const pulse = reduced ? 0 : (Math.sin(tick / 20 + index) + 1) * 5
        context.beginPath(); context.arc(x, y, 18 + pulse, 0, Math.PI * 2)
        context.globalAlpha = .4
        context.strokeStyle = hub.status === 'warning' ? warning : lime
        context.stroke()
        context.globalAlpha = 1
        context.beginPath(); context.arc(x, y, 14, 0, Math.PI * 2); context.fillStyle = hub.status === 'warning' ? warning : lime; context.fill()
        context.fillStyle = 'white'; context.font = '12px Inter'; context.fillText(hub.id, x - 25, y + 38)
      })
      tick += 1
      if (!reduced) frame = requestAnimationFrame(draw)
    }
    draw()
    const resize = () => draw()
    window.addEventListener('resize', resize)
    const click = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left, y = event.clientY - rect.top
      const hub = warehouses.find((item) => Math.hypot(x - (30 + item.coords[0] * (rect.width - 60)), y - (30 + item.coords[1] * (rect.height - 60))) < 28)
      if (hub) onSelect(hub)
    }
    canvas.addEventListener('click', click)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); canvas.removeEventListener('click', click) }
  }, [warehouses, onSelect])
  return <canvas className="canvas-map" ref={ref} aria-label="Interactive warehouse network map" role="img" />
}
