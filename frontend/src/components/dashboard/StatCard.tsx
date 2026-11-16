import { motion } from 'framer-motion'
import { useCountUp } from '../../lib/useCountUp'

export function StatCard({ title, value, suffix = '', prefix = '', note }: { title: string; value: number; suffix?: string; prefix?: string; note?: string }) {
  const safeValue = Number.isFinite(value) ? value : 0
  const count = useCountUp(safeValue)
  const display = Number.isInteger(safeValue) ? Math.round(count).toLocaleString() : (Number.isFinite(count) ? count : 0).toFixed(2)
  return <motion.article
    className="card-ops stat-card"
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -2, transition: { type: 'spring', stiffness: 400, damping: 25 } }}
    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
  >
    <span className="mono-label">{title}</span>
    <strong className="stat-value">{prefix}{display}{suffix}</strong>
    {note && <span className="ops-muted stat-card-note">{note}</span>}
  </motion.article>
}
