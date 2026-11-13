import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'

export function DashboardLayout() {
  return <div className="ops dashboard-shell">
    <Sidebar />
    <div className="dashboard-main">
      <Navbar />
      <Outlet />
    </div>
  </div>
}
