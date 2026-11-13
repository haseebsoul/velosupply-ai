import { AnimatePresence, motion } from 'framer-motion'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LandingPage } from './pages/LandingPage'
import { StorePage } from './pages/StorePage'
import { LoginPage } from './pages/LoginPage'
import { RegistrationPage } from './pages/RegistrationPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { DashboardLayout } from './components/dashboard/DashboardLayout'
import { CommandPages } from './pages/dashboard/CommandPages'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })
const viewMotion = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: .24, ease: [0.22, 1, 0.36, 1] } }

function AnimatedRoutes() {
  const location = useLocation()
  return <AnimatePresence mode="wait"><motion.div key={location.pathname} {...viewMotion}>
    <Routes location={location}>
      <Route path="/" element={<LandingPage />} />
      <Route path="/store" element={<StorePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegistrationPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/messages" element={<Navigate to="/dashboard/messages" replace />} />
        <Route path="/rewards" element={<Navigate to="/dashboard/rewards" replace />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<CommandPages />} />
          <Route path="topology" element={<CommandPages />} />
          <Route path="threats" element={<CommandPages />} />
          <Route path="activity" element={<CommandPages />} />
          <Route path="messages" element={<CommandPages />} />
          <Route path="manage" element={<CommandPages />} />
          <Route path="rewards" element={<CommandPages />} />
          <Route path="reports" element={<CommandPages />} />
          <Route path="account" element={<CommandPages />} />
          <Route path="admin" element={<CommandPages />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </motion.div></AnimatePresence>
}

export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AnimatedRoutes /></BrowserRouter></QueryClientProvider>
}
