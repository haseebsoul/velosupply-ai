import { create } from 'zustand'
import type { User } from '../types'

interface AppState {
  token: string | null
  user: User | null
  setSession: (token: string, user: User) => void
  setUser: (user: User | null) => void
  logout: () => void
}

export const useAppStore = create<AppState>((set) => ({
  token: localStorage.getItem('velosupply-token'),
  user: null,
  setSession: (token, user) => {
    localStorage.setItem('velosupply-token', token)
    set({ token, user })
  },
  setUser: (user) => set({ user }),
  logout: () => {
    localStorage.removeItem('velosupply-token')
    set({ token: null, user: null })
  },
}))
