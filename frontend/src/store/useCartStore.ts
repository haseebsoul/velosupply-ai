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
    const existing = state.lines.find((line) => line.product.id === product.id)
    return {
      open: true,
      lines: existing
        ? state.lines.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + quantity } : line)
        : [...state.lines, { product, quantity }],
    }
  }),
  setQuantity: (productId, quantity) => set((state) => ({
    lines: quantity <= 0
      ? state.lines.filter((line) => line.product.id !== productId)
      : state.lines.map((line) => line.product.id === productId ? { ...line, quantity } : line),
  })),
  remove: (productId) => set((state) => ({ lines: state.lines.filter((line) => line.product.id !== productId) })),
  clear: () => set({ lines: [] }),
  setOpen: (open) => set({ open }),
}))
