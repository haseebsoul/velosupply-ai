export type UserRole = 'admin' | 'operator' | 'user'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
}

export interface Product {
  id: string
  sku: string
  name: string
  description: string
  category: string
  price: number
  priceExGstPkr?: number
  currency?: 'PKR' | string
  leadDays?: number
  featured?: boolean
  demoRecord?: boolean
  stock: number
  onHand?: number
  reserved?: number
  available?: number
  reorder_threshold: number
  warehouse_hub: string
  velocity_per_hr: number
  status: 'optimal' | 'low_stock' | 'critical'
}

export interface Warehouse {
  id: string
  name: string
  coords: [number, number]
  capacity: number
  latency: number
  status: 'online' | 'warning' | 'offline'
}

export interface OrderItem {
  productId: string
  quantity: number
}

export interface Order {
  id: string
  customerName: string
  customerEmail: string
  shippingRegion: string
  items: OrderItem[]
  total?: number
  status: string
  warehouse_hub?: string
  createdAt?: string
}

export interface Metrics {
  gmv24h: number
  activeOrders: number
  fulfillmentHealth: number
  packetsPerSec: number
  avgLatencyMs: number
  threatsBlocked: number
  detectionTimeMs: number
  efficiencyScore: number
  hubCapacities: Array<{ name: string; capacity: number }>
}

export interface TelemetryEvent {
  type: string
  level?: 'INFO' | 'WARN' | 'CRITICAL'
  message?: string
  timestamp?: string
  metrics?: Metrics
  warehouses?: Warehouse[]
  order?: Order
}
