import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck, ShoppingBag, Truck } from 'lucide-react'
import { VeloSupplyLogo } from '../components/VeloSupplyLogo'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, errorMessage } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import type { User, UserRole } from '../types'

const schema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password')
})
type Fields = z.infer<typeof schema>

const accessRoles: Array<{ value: UserRole; label: string; description: string; icon: typeof ShieldCheck }> = [
  { value: 'admin', label: 'Administrator', description: 'Governance, catalog and workspace controls', icon: ShieldCheck },
  { value: 'operator', label: 'Operations team', description: 'Inventory, routing and fulfillment', icon: Truck },
  { value: 'buyer', label: 'Buyer', description: 'Hardware procurement and order tracking', icon: ShoppingBag }
]

function NetworkCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const styles = getComputedStyle(document.documentElement)
    const lineColor = styles.getPropertyValue('--ink-muted').trim()
    const nodeColor = styles.getPropertyValue('--navy-700').trim()
    const signalColor = styles.getPropertyValue('--orange-500').trim()
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const points = Array.from({ length: 64 }, (_, index) => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - .5) * .012, vy: (Math.random() - .5) * .012,
      hub: index % 17 === 0, pulse: Math.random() * Math.PI * 2
    }))
    const packets: Array<{ from: number; to: number; progress: number; speed: number }> = []
    const pointer = { x: -1000, y: -1000, active: false }
    let width = 0, height = 0, ratio = 1, frame = 0, previous = 0, nextPacketAt = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      draw(0, true)
    }

    const draw = (time: number, staticFrame = false) => {
      if (!width || !height) return
      const dt = previous ? Math.min((time - previous) / 1000, .04) : 0
      previous = time
      context.clearRect(0, 0, width, height)

      const coordinates = points.map((point) => {
        let x = point.x * width
        let y = point.y * height
        if (!motionQuery.matches && pointer.active) {
          const dx = pointer.x - x
          const dy = pointer.y - y
          const distance = Math.hypot(dx, dy)
          if (distance < 140 && distance > 1) {
            const pull = (1 - distance / 140) * 42
            x += (dx / distance) * pull
            y += (dy / distance) * pull
          }
        }
        return { x, y }
      })

      const edges: Array<{ from: number; to: number }> = []
      for (let i = 0; i < coordinates.length; i += 1) {
        for (let j = i + 1; j < coordinates.length; j += 1) {
          const a = coordinates[i]
          const b = coordinates[j]
          const distance = Math.hypot(a.x - b.x, a.y - b.y)
          if (distance > 132) continue
          edges.push({ from: i, to: j })
          const pointerDistance = pointer.active ? Math.min(
            Math.hypot(pointer.x - a.x, pointer.y - a.y),
            Math.hypot(pointer.x - b.x, pointer.y - b.y)
          ) : Infinity
          const highlighted = pointerDistance < 140
          context.beginPath()
          context.moveTo(a.x, a.y)
          context.lineTo(b.x, b.y)
          context.strokeStyle = highlighted ? signalColor : lineColor
          context.globalAlpha = (highlighted ? .44 : .18) * (1 - distance / 132)
          context.lineWidth = highlighted ? 1.35 : .8
          context.stroke()
        }
      }

      if (!motionQuery.matches && time >= nextPacketAt && edges.length) {
        const edge = edges[Math.floor(Math.random() * edges.length)]
        packets.push({ ...edge, progress: 0, speed: .34 + Math.random() * .28 })
        nextPacketAt = time + 650 + Math.random() * 950
      }
      if (!motionQuery.matches) {
        for (let i = packets.length - 1; i >= 0; i -= 1) {
          const packet = packets[i]
          packet.progress += dt * packet.speed
          if (packet.progress >= 1) { packets.splice(i, 1); continue }
          const a = coordinates[packet.from]
          const b = coordinates[packet.to]
          const x = a.x + (b.x - a.x) * packet.progress
          const y = a.y + (b.y - a.y) * packet.progress
          context.beginPath()
          context.arc(x, y, 2, 0, Math.PI * 2)
          context.fillStyle = signalColor
          context.shadowColor = signalColor
          context.shadowBlur = 10
          context.globalAlpha = .9
          context.fill()
          context.shadowBlur = 0
        }
      }

      points.forEach((point, index) => {
        const { x, y } = coordinates[index]
        if (point.hub) {
          const phase = motionQuery.matches ? .38 : (time / 1150 + point.pulse) % (Math.PI * 2)
          const radius = 8 + (phase / (Math.PI * 2)) * 22
          context.beginPath()
          context.arc(x, y, radius, 0, Math.PI * 2)
          context.strokeStyle = signalColor
          context.globalAlpha = motionQuery.matches ? .16 : .2 * (1 - phase / (Math.PI * 2))
          context.lineWidth = 1
          context.stroke()
        }
        context.beginPath()
        context.arc(x, y, point.hub ? 3.3 : 1.8, 0, Math.PI * 2)
        context.fillStyle = point.hub ? signalColor : nodeColor
        context.globalAlpha = point.hub ? .9 : .58
        context.fill()
      })
      context.globalAlpha = 1

      if (!motionQuery.matches && !staticFrame) {
        points.forEach((point) => {
          point.x += point.vx * dt
          point.y += point.vy * dt
          if (point.x < .02 || point.x > .98) point.vx *= -1
          if (point.y < .02 || point.y > .98) point.vy *= -1
          point.x = Math.max(.02, Math.min(.98, point.x))
          point.y = Math.max(.02, Math.min(.98, point.y))
        })
        frame = window.requestAnimationFrame((next) => draw(next))
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = event.clientX - rect.left
      pointer.y = event.clientY - rect.top
      pointer.active = true
    }
    const onPointerLeave = () => { pointer.active = false }
    const onMotionChange = () => {
      window.cancelAnimationFrame(frame)
      previous = 0
      if (motionQuery.matches) draw(0, true)
      else frame = window.requestAnimationFrame((time) => draw(time))
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('resize', resize)
    motionQuery.addEventListener?.('change', onMotionChange)
    resize()
    if (!motionQuery.matches) frame = window.requestAnimationFrame((time) => draw(time))
    return () => {
      window.cancelAnimationFrame(frame)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('resize', resize)
      motionQuery.removeEventListener?.('change', onMotionChange)
    }
  }, [])
  return <canvas ref={ref} aria-hidden="true" />
}

export function LoginPage() {
  const navigate = useNavigate()
  const setSession = useAppStore((state) => state.setSession)
  const [visible, setVisible] = useState(false)
  const [selectedRole, setSelectedRole] = useState<UserRole>('buyer')
  const [error, setError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' }
  })

  const submit = async (values: Fields) => {
    setError('')
    try {
      const { data } = await api.post<{ token: string; user: User }>('/auth/login', values)
      const actualRole = data.user.role === 'user' ? 'buyer' : data.user.role
      if (actualRole !== selectedRole) {
        const actualLabel = accessRoles.find((role) => role.value === actualRole)?.label || 'another workspace'
        setError(`This account belongs to ${actualLabel}. Choose that role and sign in again.`)
        return
      }
      setSession(data.token, { ...data.user, role: actualRole })
      navigate('/dashboard', { replace: true })
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return <main className="login-screen">
    <section className="login-art">
      <NetworkCanvas />
      <div className="login-art-copy">
        <VeloSupplyLogo size="lg" />
        <span className="mono-label login-kicker">OPERATIONS, CONNECTED</span>
        <h1>Decode the future with autonomous logistics.</h1>
        <p className="ops-muted">A clear view of every unit, every hub and every delivery.</p>
        <span className="mono-label login-edition">SUPPLY CHAIN INTELLIGENCE · PAKISTAN EDITION</span>
      </div>
    </section>
    <section className="login-form-wrap">
      <form className="login-form" onSubmit={handleSubmit(submit)} noValidate>
        <span className="mono-label login-form-kicker">SECURE WORKSPACE ACCESS</span>
        <h2>Welcome back.</h2>
        <p className="ops-copy">Choose your workspace, then enter your credentials.</p>
        <fieldset className="login-role-fieldset">
          <legend>Sign in to</legend>
          <div className="login-role-grid">
            {accessRoles.map(({ value, label, description, icon: Icon }) => <button
              key={value}
              type="button"
              className={`login-role-card ${selectedRole === value ? 'selected' : ''}`}
              aria-pressed={selectedRole === value}
              onClick={() => { setSelectedRole(value); setError('') }}
            >
              <Icon size={19} />
              <span className="login-role-label">{label}</span>
              <span className="login-role-description">{description}</span>
            </button>)}
          </div>
        </fieldset>
        <div className="login-divider"><span>YOUR CREDENTIALS</span></div>
        <label className="ops-copy login-label">Email address
          <input className="field" type="email" autoComplete="username" placeholder="name@company.com" {...register('email')} />
          {errors.email && <small className="danger-text">{errors.email.message}</small>}
        </label>
        <label className="ops-copy login-label">Password
          <div className="login-password-field">
            <input className="field" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" {...register('password')} />
            <button type="button" aria-label={visible ? 'Hide password' : 'Show password'} className="password-toggle" onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          {errors.password && <small className="danger-text">{errors.password.message}</small>}
        </label>
        {error && <p role="alert" className="danger-text login-error">{error}</p>}
        <button className="button ops-button login-submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Continue to workspace'}</button>
        <p className="ops-copy login-register">Need an account? <Link to="/register">Create an account</Link></p>
      </form>
    </section>
  </main>
}
