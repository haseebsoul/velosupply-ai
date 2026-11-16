import { useMemo, useState } from 'react'
import { Bell, ChevronDown, LogOut, Search, UserRound } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/useAppStore'

const titles: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/topology': 'Network map',
  '/dashboard/threats': 'Inventory alerts',
  '/dashboard/activity': 'Activity',
  '/dashboard/reliability': 'Reliability',
  '/dashboard/messages': 'Messages',
  '/dashboard/manage': 'Manage inventory',
  '/dashboard/rewards': 'Program',
  '/dashboard/reports': 'Reports',
  '/dashboard/account': 'Account',
  '/dashboard/admin': 'User access',
  '/dashboard/access': 'Invitation keys',
  '/dashboard/deliveries': 'Delivery assignments'
}

const quickLinks: Array<{ label: string; to: string; adminOnly?: boolean }> = [
  { label: 'Overview', to: '/dashboard' },
  { label: 'Activity', to: '/dashboard/activity' },
  { label: 'Reliability', to: '/dashboard/reliability', adminOnly: true },
  { label: 'Messages', to: '/dashboard/messages', adminOnly: true },
  { label: 'Network map', to: '/dashboard/topology' },
  { label: 'Inventory alerts', to: '/dashboard/threats' },
  { label: 'Manage inventory', to: '/dashboard/manage' },
  { label: 'Delivery assignments', to: '/dashboard/deliveries' },
  { label: 'Program', to: '/dashboard/rewards', adminOnly: true },
  { label: 'Reports', to: '/dashboard/reports' },
  { label: 'Account', to: '/dashboard/account', adminOnly: true },
  { label: 'User access', to: '/dashboard/admin', adminOnly: true },
  { label: 'Invitation keys', to: '/dashboard/access', adminOnly: true }
]

export function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAppStore((state) => state.user)
  const logout = useAppStore((state) => state.logout)
  const [search, setSearch] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const title = titles[location.pathname] ?? 'Operations'
  const initials = (user?.name ?? 'VeloSupply').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  const roleLabel = user?.role === 'admin' ? 'Administrator' : user?.role === 'operator' ? 'Operations team' : 'Buyer'
  const matches = useMemo(() => {
    const value = search.trim().toLowerCase()
    return value
      ? quickLinks.filter((item) => (!item.adminOnly || user?.role === 'admin') && item.label.toLowerCase().includes(value)).slice(0, 5)
      : []
  }, [search, user?.role])

  return <header className="dashboard-navbar">
    <div className="navbar-page-title">
      <span className="navbar-breadcrumb">Workspace <span>/</span> Operations</span>
      <strong>{title}</strong>
    </div>
    <div className="navbar-tools">
      <div className="navbar-search-wrap">
        <Search size={15} />
        <input
          aria-label="Search workspace"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) { navigate(matches[0].to); setSearch('') }
            if (event.key === 'Escape') setSearch('')
          }}
          placeholder="Search workspace"
        />
        <kbd>⌘ K</kbd>
        {matches.length > 0 && <div className="navbar-search-results">{matches.map((item) => <Link key={item.to} to={item.to} onClick={() => setSearch('')}>{item.label}<span>Open</span></Link>)}</div>}
      </div>

      <div className="navbar-popover-wrap">
        <button className="navbar-icon-button notification-button" type="button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((value) => !value); setProfileOpen(false) }}>
          <Bell size={18} />
        </button>
        {notificationsOpen && <div className="navbar-popover notification-popover">
          <div className="popover-heading"><strong>Workspace notices</strong><span>Sample feed</span></div>
          <Link to="/dashboard/messages" onClick={() => setNotificationsOpen(false)}><span className="notification-dot" /><span><strong>Priority support notice</strong><small>Review the current workspace message</small></span></Link>
          <Link to="/dashboard/threats" onClick={() => setNotificationsOpen(false)}><span className="notification-dot warning-dot" /><span><strong>Inventory monitoring</strong><small>Review items at reorder threshold</small></span></Link>
        </div>}
      </div>

      <div className="navbar-popover-wrap">
        <button className="profile-trigger" type="button" aria-expanded={profileOpen} onClick={() => { setProfileOpen((value) => !value); setNotificationsOpen(false) }}>
          <span className="profile-avatar">{initials}</span>
          <span className="profile-trigger-copy"><strong>{user?.name ?? 'Workspace user'}</strong><small>{roleLabel}</small></span>
          <ChevronDown size={14} />
        </button>
        {profileOpen && <div className="navbar-popover profile-popover">
          <div className="profile-popover-user"><span className="profile-avatar">{initials}</span><span><strong>{user?.name ?? 'Workspace user'}</strong><small>{user?.email ?? 'Signed in'}</small></span></div>
          <Link to="/dashboard/account" onClick={() => setProfileOpen(false)}><UserRound size={15} /> Account settings</Link>
          <button onClick={() => { logout(); navigate('/login', { replace: true }) }}><LogOut size={15} /> Sign out</button>
        </div>}
      </div>
    </div>
  </header>
}
