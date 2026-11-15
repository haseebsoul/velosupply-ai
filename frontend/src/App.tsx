import { AnimatePresence, motion } from 'framer-motion'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LandingPage } from './pages/LandingPage'
import { StorePage } from './pages/StorePage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { BuyerOrdersPage } from './pages/BuyerOrdersPage'
import { BuyerAccountPage } from './pages/BuyerAccountPage'
import { InvitationKeysPage } from './pages/dashboard/InvitationKeysPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { DashboardLayout } from './components/dashboard/DashboardLayout'
import { CommandPages } from './pages/dashboard/CommandPages'
import { ReliabilityPage } from './pages/dashboard/ReliabilityPage'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { useAppStore } from './store/useAppStore'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })
const viewMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: .22, ease: 'easeOut' }
}

function AnimatedRoutes() {
  const location = useLocation()
  return <AnimatePresence mode="wait"><motion.div key={location.pathname} {...viewMotion}>
    <Routes location={location}>
      <Route path="/" element={<LandingPage />} />
      <Route path="/store" element={<StorePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<ProtectedRoute allowedRoles={['buyer']} />}>
        <Route path="/store/orders" element={<BuyerOrdersPage />} />
        <Route path="/store/account" element={<BuyerAccountPage />} />
      </Route>

      <Route element={<ProtectedRoute allowedRoles={['admin', 'operator']} />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<CommandPages />} />
          <Route path="activity" element={<CommandPages />} />
          <Route path="topology" element={<CommandPages />} />
          <Route path="threats" element={<CommandPages />} />
          <Route path="manage" element={<CommandPages />} />
          <Route path="reports" element={<CommandPages />} />
          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="reliability" element={<ReliabilityPage />} />
            <Route path="messages" element={<CommandPages />} />
            <Route path="rewards" element={<CommandPages />} />
            <Route path="account" element={<CommandPages />} />
            <Route path="admin" element={<CommandPages />} />
            <Route path="access" element={<InvitationKeysPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </motion.div></AnimatePresence>
}

export default function App() {
  return <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AppErrorBoundary
        title="VeloSupply could not render this page"
        actionLabel="Reset session & reload"
        onReset={() => { useAppStore.getState().logout(); window.location.assign('/login') }}
      >
        <AnimatedRoutes />
      </AppErrorBoundary>
    </BrowserRouter>
  </QueryClientProvider>
}
