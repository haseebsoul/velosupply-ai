import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, ChevronDown, LogOut, Search, UserRound } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/useAppStore'

const pages = [
  { path: '/dashboard', title: 'Overview' },
  { path: '/dashboard/activity', title: 'Activity' },
  { path: '/dashboard/manage', title: 'Manage inventory' },
  { path: '/dashboard/rewards', title: 'Program' },
  { path: '/dashboard/messages', title: 'Messages' },
  { path: '/dashboard/account', title: 'Account' },
  { path: '/dashboard/reports', title: 'Reports' },
  { path: '/dashboard/topology', title: 'Network topology' },
  { path: '/dashboard/threats', title: 'Inventory alerts' },
  { path: '/dashboard/admin', title: 'Stakeholders' },
]

export function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAppStore()
  const [search, setSearch] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const title = pages.find((page) => page.path === location.pathname)?.title ?? 'Operations'
  const roleLabel = user?.role === 'admin' ? 'Administrator' : user?.role === 'operator' ? 'Operations' : 'Buyer'
  const suggestions = useMemo(() => pages
    .filter((page) => `${page.title} ${page.path}`.toLowerCase().includes(search.toLowerCase()))
    .filter((page) => page.path !== '/dashboard/admin' || user?.role === 'admin')
    .slice(0, 5), [search, user?.role])

  return <header className="dashboard-navbar">
    <div className="navbar-heading">
      <span className="navbar-breadcrumb">VeloSupply <span>/</span> Workspace</span>
      <strong>{title}</strong>
    </div>
    <div className="navbar-tools">
      <div className="navbar-search-wrap">
        <label className="navbar-search">
          <Search size={16} strokeWidth={1.7} />
          <input
            aria-label="Search dashboard pages"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && suggestions[0]) {
                navigate(suggestions[0].path)
                setSearch('')
              }
              if (event.key === 'Escape') setSearch('')
            }}
            placeholder="Search workspace"
          />
          <kbd>Enter</kbd>
        </label>
        <AnimatePresence>
          {search && <motion.div className="navbar-search-results" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: .16 }}>
            {suggestions.length ? suggestions.map((page) => <button key={page.path} onClick={() => { navigate(page.path); setSearch('') }}>{page.title}<span>{page.path.replace('/dashboard', 'Dashboard')}</span></button>) : <p>No matching pages</p>}
          </motion.div>}
        </AnimatePresence>
      </div>
      <Link title="Open messages" aria-label="Open messages" to="/dashboard/messages" className="navbar-icon-button">
        <Bell size={17} strokeWidth={1.7} /><span className="notification-count">1</span>
      </Link>
      <div className="profile-menu">
        <button className="profile-trigger" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
          <span className="profile-avatar">{user?.name?.slice(0, 1).toUpperCase() ?? 'V'}</span>
          <span className="profile-copy"><strong>{user?.name ?? 'VeloSupply user'}</strong><small>{roleLabel}</small></span>
          <ChevronDown size={15} />
        </button>
        <AnimatePresence>
          {profileOpen && <motion.div className="profile-dropdown" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} transition={{ duration: .16 }}>
            <Link to="/dashboard/account" onClick={() => setProfileOpen(false)}><UserRound size={15} /> Account settings</Link>
            <button onClick={() => { setProfileOpen(false); logout(); navigate('/login') }}><LogOut size={15} /> Sign out</button>
          </motion.div>}
        </AnimatePresence>
      </div>
    </div>
  </header>
}
