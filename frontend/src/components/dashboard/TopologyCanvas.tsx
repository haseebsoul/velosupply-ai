import { useEffect, useRef } from 'react'
import type { Warehouse } from '../../types'

export function TopologyCanvas({ warehouses, onSelect }: { warehouses: Warehouse[]; onSelect: (hub: Warehouse) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    let frame = 0
    let tick = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const css = getComputedStyle(document.documentElement)
    const colors = { healthy: css.getPropertyValue('--hex-047857').trim(), warning: css.getPropertyValue('--hex-b45309').trim(), critical: css.getPropertyValue('--hex-b91c1c').trim(), white: css.getPropertyValue('--hex-ffffff').trim(), border: css.getPropertyValue('--hex-d6d0c4').trim(), ink: css.getPropertyValue('--hex-111827').trim() }
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const points = warehouses.map((hub) => ({
        hub,
        x: 36 + hub.coords[0] * (width - 72),
        y: 32 + hub.coords[1] * (height - 96)
      }))

      context.strokeStyle = 'rgba(17,24,39,.12)'
      context.lineWidth = 1
      points.forEach((point, index) => points.slice(index + 1).forEach((next) => {
        context.beginPath()
        context.moveTo(point.x, point.y)
        context.lineTo(next.x, next.y)
        context.stroke()
        if (!reduced) {
          context.save()
          context.setLineDash([3, 7])
          context.lineDashOffset = -tick % 40
          context.strokeStyle = 'rgba(200,75,17,.4)'
          context.lineWidth = 1.2
          context.beginPath()
          context.moveTo(point.x, point.y)
          context.lineTo(next.x, next.y)
          context.stroke()
          context.restore()
        }
      }))

      points.forEach(({ hub, x, y }, index) => {
        const online = hub.status === 'online'
        const accent = online ? colors.healthy : hub.status === 'warning' ? colors.warning : colors.critical
        const pulse = reduced ? 0 : (Math.sin(tick / 18 + index) + 1) * 4
        context.beginPath()
        context.arc(x, y, 19 + pulse, 0, Math.PI * 2)
        context.strokeStyle = accent
        context.globalAlpha = .22
        context.lineWidth = 1.5
        context.stroke()
        context.globalAlpha = 1

        context.beginPath()
        context.arc(x, y, 13, 0, Math.PI * 2)
        context.fillStyle = colors.white
        context.fill()
        context.strokeStyle = accent
        context.lineWidth = 2
        context.stroke()
        context.beginPath()
        context.arc(x, y, 6, 0, Math.PI * 2)
        context.fillStyle = accent
        context.fill()

        const label = `${hub.id} · ${Math.round(Number(hub.latency) || 0)}ms`
        context.font = '11px "Geist Mono", monospace'
        const labelWidth = context.measureText(label).width + 16
        const labelHeight = 23
        const labelLeft = Math.min(width - labelWidth - 6, Math.max(6, x - labelWidth / 2))
        const labelTop = Math.min(height - labelHeight - 6, y + 24)
        context.beginPath()
        context.roundRect(labelLeft, labelTop, labelWidth, labelHeight, 7)
        context.fillStyle = colors.white
        context.fill()
        context.strokeStyle = colors.border
        context.lineWidth = 1
        context.stroke()
        context.fillStyle = colors.ink
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(label, labelLeft + labelWidth / 2, labelTop + labelHeight / 2)
      })
      context.textAlign = 'start'
      context.textBaseline = 'alphabetic'
      tick += 1
      if (!reduced) frame = requestAnimationFrame(draw)
    }

    draw()
    const resize = () => draw()
    window.addEventListener('resize', resize)
    const click = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const hub = warehouses.find((item) => Math.hypot(
        x - (36 + item.coords[0] * (rect.width - 72)),
        y - (32 + item.coords[1] * (rect.height - 96))
      ) < 28)
      if (hub) onSelect(hub)
    }
    canvas.addEventListener('click', click)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('click', click)
    }
  }, [warehouses, onSelect])
  return <canvas className="canvas-map" ref={ref} aria-label="Interactive warehouse network map. Select a hub to inspect its recorded status." role="img" />
}
