import { Bell, Search } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAppStore } from '../../store/useAppStore'

const titles: Record<string, string> = {
  '/dashboard': 'Operations overview', '/dashboard/topology': 'Network topology', '/dashboard/threats': 'Inventory threats',
  '/dashboard/activity': 'Live activity', '/dashboard/manage': 'Inventory management', '/dashboard/rewards': 'AI efficiency rewards',
  '/dashboard/reports': 'Operations reports', '/dashboard/account': 'Account & system', '/dashboard/admin': 'User administration',
}
export function Navbar() {
  const location = useLocation()
  const user = useAppStore((state) => state.user)
  const title = titles[location.pathname] ?? 'Operations'
  return <header className="dashboard-navbar"><div><div className="mono-label">VELOSUPPLY / COMMAND</div><strong>{title}</strong></div><div className="inline-actions"><label style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, top: 10 }} /><input aria-label="Search operations" className="field" style={{ width: 180, padding: '8px 10px 8px 32px', fontSize: 12 }} placeholder="Search…  ⌘K" /></label><Link title="View inventory threats" to="/dashboard/threats" className="small-button"><Bell size={16} /></Link><span className="mono-label">{user?.name}</span></div></header>
}
