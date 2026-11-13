import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import type { User } from '../types'

export function ProtectedRoute() {
  const { token, user, setUser, logout } = useAppStore()
  const [checked, setChecked] = useState(Boolean(user))

  useEffect(() => {
    if (!token || user) {
      setChecked(true)
      return
    }
    let active = true
    api.get<{ user: User }>('/auth/me').then(({ data }) => {
      if (active) setUser(data.user)
    }).catch(() => {
      if (active) logout()
    }).finally(() => {
      if (active) setChecked(true)
    })
    return () => { active = false }
  }, [token, user, setUser, logout])

  if (!token) return <Navigate to="/login" replace />
  if (!checked) return <div className="loading-screen">Verifying secure session…</div>
  return user ? <Outlet /> : <Navigate to="/login" replace />
}
