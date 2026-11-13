import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Boxes } from 'lucide-react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, errorMessage } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import type { User } from '../types'

const schema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') })
type Fields = z.infer<typeof schema>

function NetworkCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const styles = getComputedStyle(document.documentElement)
    const edgeColor = styles.getPropertyValue('--border-ops').trim()
    const nodeColor = styles.getPropertyValue('--accent-ops-lime').trim()
    const points = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2 }))
    let frame = 0
    let angle = 0
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      context.scale(ratio, ratio)
      const width = rect.width, height = rect.height
      context.clearRect(0, 0, width, height)
      const cx = width / 2, cy = height / 2
      const radius = Math.min(width, height) * .48
      const coords = points.map((point) => {
        const a = point.phase + angle
        return { x: cx + Math.cos(a) * (point.x * radius), y: cy + Math.sin(a) * (point.y * radius) }
      })
      coords.forEach((point, index) => {
        coords.slice(index + 1).forEach((other) => {
          const distance = Math.hypot(point.x - other.x, point.y - other.y)
          if (distance < 110) {
            context.strokeStyle = edgeColor
            context.globalAlpha = .2 * (1 - distance / 110)
            context.lineWidth = 1
            context.beginPath()
            context.moveTo(point.x, point.y)
            context.lineTo(other.x, other.y)
            context.stroke()
            context.globalAlpha = 1
          }
        })
        context.beginPath()
        context.arc(point.x, point.y, 3, 0, Math.PI * 2)
        context.fillStyle = nodeColor
        context.globalAlpha = .8
        context.fill()
        context.globalAlpha = 1
      })
      if (!reduced) angle += .0014
      if (!reduced) frame = requestAnimationFrame(draw)
    }
    draw()
    const resize = () => draw()
    window.addEventListener('resize', resize)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={ref} aria-hidden="true" />
}

export function LoginPage() {
  const navigate = useNavigate()
  const setSession = useAppStore((state) => state.setSession)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Fields>({ resolver: zodResolver(schema) })
  const submit = async (values: Fields) => {
    setError('')
    try {
      const { data } = await api.post<{ token: string; user: User }>('/auth/login', values)
      setSession(data.token, data.user)
      navigate('/dashboard', { replace: true })
    } catch (reason) { setError(errorMessage(reason)) }
  }
  return <main className="login-screen">
    <section className="login-art"><NetworkCanvas /><div className="login-art-copy"><Link className="brand" to="/" style={{ color: 'var(--text-ops-primary)' }}><span className="brand-mark"><Boxes size={16} /></span> VeloSupply AI</Link><h1 style={{ fontSize: 46, maxWidth: 470, lineHeight: 1.05, letterSpacing: '-.05em' }}>Decode the future with autonomous logistics.</h1><p className="ops-muted">One network. Every signal. Always in motion.</p></div></section>
    <section className="login-form-wrap"><form className="login-form" onSubmit={handleSubmit(submit)}><span className="mono-label" style={{ color: 'var(--accent-ops-lime)' }}>SECURE OPERATIONS ACCESS</span><h2 style={{ fontSize: 32, letterSpacing: '-.05em' }}>Welcome back.</h2><p className="ops-copy">Sign in to your VeloSupply command center.</p>
      <button type="button" className="small-button" style={{ width: '100%', margin: '12px 0 24px' }} onClick={() => { setValue('email', 'admin@velosupply.ai'); setValue('password', '1234') }}>Fill Admin Demo · admin@velosupply.ai</button>
      <label className="ops-copy">Email<input className="field" type="email" autoComplete="email" {...register('email')} /></label>{errors.email && <small className="danger-text">{errors.email.message}</small>}
      <label className="ops-copy" style={{ display: 'block', marginTop: 16 }}>Password<div style={{ position: 'relative' }}><input className="field" type={visible ? 'text' : 'password'} autoComplete="current-password" {...register('password')} /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} className="small-button" style={{ position: 'absolute', right: 7, top: 7 }} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>{errors.password && <small className="danger-text">{errors.password.message}</small>}
      {error && <p role="alert" className="danger-text">{error}</p>}<button className="button ops-button" style={{ width: '100%', marginTop: 22 }} disabled={isSubmitting}>{isSubmitting ? 'Authenticating…' : 'Sign in to console'}</button>
      <p className="ops-copy" style={{ marginTop: 22 }}>New to VeloSupply? <Link to="/" style={{ color: 'var(--accent-ops-lime)' }}>Explore the platform</Link></p>
    </form></section>
  </main>
}
