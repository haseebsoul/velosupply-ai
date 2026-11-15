import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import type { User, UserRole } from '../types'

interface ProtectedRouteProps {
  allowedRoles?: UserRole[]
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const token = useAppStore((state) => state.token)
  const user = useAppStore((state) => state.user)
  const setUser = useAppStore((state) => state.setUser)
  const logout = useAppStore((state) => state.logout)
  const [checked, setChecked] = useState(Boolean(user))

  useEffect(() => {
    if (!token || user) {
      setChecked(true)
      return
    }
    let active = true
    setChecked(false)
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
  if (!user) return <Navigate to="/login" replace />

  const role: UserRole = user.role === 'user' ? 'buyer' : user.role
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to={role === 'buyer' ? '/store/orders' : '/dashboard'} replace />
  }
  return <Outlet />
}
