import { create } from 'zustand'
import type { Product } from '../types'

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
    const nextQuantity = Math.min(available, (existing?.quantity ?? 0) + quantity)
    if (nextQuantity <= 0) return { open: true }
    return {
      open: true,
      lines: existing
        ? state.lines.map((line) => line.product.id === product.id ? { ...line, product, quantity: nextQuantity } : line)
        : [...state.lines, { product, quantity: nextQuantity }],
    }
  }),
  setQuantity: (productId, quantity) => set((state) => ({
    lines: quantity <= 0
      ? state.lines.filter((line) => line.product.id !== productId)
      : state.lines.map((line) => line.product.id === productId
        ? { ...line, quantity: Math.min(quantity, line.product.available ?? line.product.stock) }
        : line),
  })),
  remove: (productId) => set((state) => ({ lines: state.lines.filter((line) => line.product.id !== productId) })),
  clear: () => set({ lines: [] }),
  setOpen: (open) => set({ open }),
}))
