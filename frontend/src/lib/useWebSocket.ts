import { useEffect, useState } from 'react'
import type { TelemetryEvent } from '../types'
import { api } from './apiClient'

export function useWebSocket() {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<TelemetryEvent[]>([])
  const [latest, setLatest] = useState<TelemetryEvent | null>(null)

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: number | undefined
    let retryDelay = 1000
    let closed = false
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/telemetry`)
      socket.onopen = () => {
        setConnected(true)
        retryDelay = 1000
        api.get('/metrics').then(({ data }) => {
          const event = {
            type: 'RESYNC',
            level: 'INFO',
            message: 'Telemetry snapshot restored after reconnect.',
            timestamp: new Date().toISOString(),
            metrics: data
          } as TelemetryEvent
          setLatest(event)
          setEvents((current) => [...current.slice(-499), event])
        }).catch((error: unknown) => {
          console.error('Unable to resync telemetry snapshot', error)
        })
      }
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as TelemetryEvent
          setLatest(event)
          setEvents((current) => [...current.slice(-499), event])
        } catch (error) {
          console.error('Unable to decode telemetry event', error)
        }
      }
      socket.onclose = () => {
        setConnected(false)
        if (!closed) {
          retry = window.setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30_000)
        }
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
