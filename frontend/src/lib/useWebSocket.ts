import { useEffect, useState } from 'react'
import type { TelemetryEvent } from '../types'

export function useWebSocket() {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<TelemetryEvent[]>([])
  const [latest, setLatest] = useState<TelemetryEvent | null>(null)

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: number | undefined
    let closed = false
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/telemetry`)
      socket.onopen = () => setConnected(true)
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as TelemetryEvent
          setLatest(event)
          setEvents((current) => [...current.slice(-99), event])
        } catch (error) {
          console.error('Unable to decode telemetry event', error)
        }
      }
      socket.onclose = () => {
        setConnected(false)
        if (!closed) retry = window.setTimeout(connect, 2000)
      }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => {
      closed = true
      if (retry !== undefined) window.clearTimeout(retry)
      socket?.close()
    }
  }, [])

  return { connected, events, latest }
}
