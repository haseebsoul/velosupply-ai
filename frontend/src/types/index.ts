export type UserRole = 'admin' | 'operator' | 'buyer' | 'user'

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
  productId?: string
  sku?: string
  name?: string
  qty?: number
  quantity?: number
  unitExGstPkr?: number
  unitPriceMinor?: number
  hubCode?: string
}

export interface Order {
  id: string
  customerName: string
  customerEmail: string
  shippingRegion: string
  items: OrderItem[]
  total?: number
  totalMinor?: number
  currency?: string
  buyerId?: string
  userId?: string
  city?: string
  address?: string
  paymentMethod?: string
  paymentState?: string
  price?: { currency?: string; totalPkr?: number; totalMinor?: number; subtotalExMinor?: number; gstMinor?: number; deliveryFeeMinor?: number; simulated?: boolean }
  status: string
  warehouse_hub?: string
  createdAt?: string
}

export interface PurchaseOrder {
  id: string
  code: string
  supplierId: string
  supplierName?: string
  lines: Array<{ sku: string; qty: number; unitExGstPkr?: number }>
  hubCode: string
  status: 'draft' | 'approved' | 'shipped' | 'received' | 'rejected'
  totalPkr: number
  createdAt: string
}

export interface InventoryThreat {
  id: string
  type: 'inventory' | 'warehouse'
  level: 'CRITICAL' | 'HIGH' | 'WARN' | 'MEDIUM'
  severity?: 'critical' | 'high' | 'medium'
  message: string
  daysOfCover?: number
  avgDaily?: number
  available?: number
  onOrder?: number
  reorderPoint?: number
  recommendQty?: number
  supplier?: { id: string; name: string; reliabilityScore?: number; leadDays?: number } | null
  product?: Product
  warehouse?: Warehouse
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
