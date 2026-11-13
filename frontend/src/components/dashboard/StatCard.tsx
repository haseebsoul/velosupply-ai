import { motion } from 'framer-motion'
import { useCountUp } from '../../lib/useCountUp'

export function StatCard({ title, value, suffix = '', prefix = '', note }: { title: string; value: number; suffix?: string; prefix?: string; note?: string }) {
  const count = useCountUp(value)
  return <motion.article className="card-ops stat-card" whileHover={{ y: -1 }} transition={{ duration: .16, ease: [0.22, 1, 0.36, 1] }}>
    <span className="mono-label">{title}</span><strong className="stat-value">{prefix}{Number.isInteger(value) ? Math.round(count).toLocaleString() : count.toFixed(2)}{suffix}</strong><span className="ops-muted" style={{ fontSize: 11 }}>{note}</span>
  </motion.article>
}
