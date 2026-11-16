import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { AppErrorBoundary } from '../AppErrorBoundary'

export function DashboardLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  return <div className="ops dashboard-shell">
    <Sidebar />
    <div className="dashboard-main">
      <Navbar />
      <div className="dashboard-route-content">
        <AppErrorBoundary
          key={location.pathname}
          title="This workspace page hit an error"
          actionLabel="Reset & go to overview"
          onReset={() => navigate('/dashboard', { replace: true })}
        >
          <Outlet />
        </AppErrorBoundary>
      </div>
    </div>
  </div>
}
