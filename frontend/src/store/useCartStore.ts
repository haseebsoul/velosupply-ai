import { create } from 'zustand'
import type { Product } from '../types'

const PILOT_CART_MAX_UNITS = 5
const totalUnits = (lines: CartLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0)

export interface CartLine {
  product: Product
  quantity: number
}

interface CartState {
  lines: CartLine[]
  open: boolean
  add: (product: Product, quantity?: number) => void
  setQuantity: (productId: string, quantity: number) => void
  remove: (productId: string) => void
  clear: () => void
  setOpen: (open: boolean) => void
}

export const useCartStore = create<CartState>((set) => ({
  lines: [],
  open: false,
  add: (product, quantity = 1) => set((state) => {
    const available = Math.max(0, product.available ?? product.stock)
    const existing = state.lines.find((line) => line.product.id === product.id)
    const otherUnits = totalUnits(state.lines) - (existing?.quantity ?? 0)
    const nextQuantity = Math.min(available, PILOT_CART_MAX_UNITS - otherUnits, (existing?.quantity ?? 0) + quantity)
    if (nextQuantity <= 0) return { open: true }
    return {
      open: true,
      lines: existing
        ? state.lines.map((line) => line.product.id === product.id ? { ...line, product, quantity: nextQuantity } : line)
        : [...state.lines, { product, quantity: nextQuantity }],
    }
  }),
  setQuantity: (productId, quantity) => set((state) => ({
    lines: (() => {
      const target = state.lines.find((line) => line.product.id === productId)
      if (!target) return state.lines
      const requested = Math.max(0, Math.trunc(quantity))
      if (requested <= 0) return state.lines.filter((line) => line.product.id !== productId)
      const remaining = PILOT_CART_MAX_UNITS - (totalUnits(state.lines) - target.quantity)
      const capped = Math.min(requested, target.product.available ?? target.product.stock, remaining)
      return capped <= 0 ? state.lines.filter((line) => line.product.id !== productId) : state.lines.map((line) => line.product.id === productId ? { ...line, quantity: capped } : line)
    })(),
  })),
  remove: (productId) => set((state) => ({ lines: state.lines.filter((line) => line.product.id !== productId) })),
  clear: () => set({ lines: [] }),
  setOpen: (open) => set({ open }),
}))
