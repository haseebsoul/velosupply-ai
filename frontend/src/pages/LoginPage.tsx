import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff } from 'lucide-react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, errorMessage } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import { BrandEmblem } from '../components/BrandEmblem'
import type { User } from '../types'

const schema = z.object({
  email: z.string().trim().email('Enter a valid email').max(254),
  password: z.string().min(1, 'Enter your password').max(128)
})
type Fields = z.infer<typeof schema>

const formVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.065 } }
}
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } }
}

function NetworkCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const accentOrange = getComputedStyle(document.documentElement).getPropertyValue('--hex-c84b11').trim()
    const points = Array.from({ length: 58 }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - .5) * .00035,
      vy: (Math.random() - .5) * .00035
    }))
    let frame = 0
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * ratio))
      canvas.height = Math.max(1, Math.round(rect.height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, rect.width, rect.height)
      const coords = points.map((point) => ({
        x: point.x * rect.width,
        y: point.y * rect.height
      }))
      coords.forEach((point, index) => {
        for (let next = index + 1; next < coords.length; next += 1) {
          const other = coords[next]
          const distance = Math.hypot(point.x - other.x, point.y - other.y)
          if (distance < 118) {
            context.strokeStyle = 'rgba(200,75,17,0.22)'
            context.globalAlpha = .65 * (1 - distance / 118)
            context.lineWidth = 1
            context.beginPath()
            context.moveTo(point.x, point.y)
            context.lineTo(other.x, other.y)
            context.stroke()
          }
        }
      })
      context.globalAlpha = 1
      coords.forEach((point) => {
        context.beginPath()
        context.arc(point.x, point.y, 2, 0, Math.PI * 2)
        context.fillStyle = accentOrange
        context.fill()
      })
      if (!reduced) {
        points.forEach((point) => {
          point.x += point.vx
          point.y += point.vy
          if (point.x < 0 || point.x > 1) point.vx *= -1
          if (point.y < 0 || point.y > 1) point.vy *= -1
          point.x = Math.min(1, Math.max(0, point.x))
          point.y = Math.min(1, Math.max(0, point.y))
        })
        frame = requestAnimationFrame(draw)
      }
    }
    draw()
    const resize = () => draw()
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas className="login-network-canvas" ref={ref} aria-hidden="true" />
}

export function LoginPage() {
  const navigate = useNavigate()
  const setSession = useAppStore((state) => state.setSession)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' }
  })

  const submit = async (values: Fields) => {
    setError('')
    try {
      const { data } = await api.post<{ token: string; user: User }>('/auth/login', values)
      setSession(data.token, data.user)
      navigate(data.user.role === 'buyer' || data.user.role === 'user' ? '/store/orders' : '/dashboard', { replace: true })
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return <main className="login-screen">
    <section className="login-art">
      <NetworkCanvas />
      <div className="login-art-copy">
        <Link className="brand login-brand" to="/"><BrandEmblem /> VeloSupply AI</Link>
        <span className="eyebrow">OPERATIONS, CONNECTED</span>
        <h1>Decode the future with autonomous logistics.</h1>
        <p>One network. Every signal. A clearer view of the work moving your business forward.</p>
        <div className="login-art-foot"><span>SUPPLY CHAIN INTELLIGENCE</span><span>PAKISTAN EDITION</span></div>
      </div>
    </section>
    <section className="login-form-wrap">
      <motion.form className="login-form" onSubmit={handleSubmit(submit)} variants={formVariants} initial="hidden" animate="visible">
        <motion.span className="login-eyebrow" variants={itemVariants}>SECURE OPERATIONS ACCESS</motion.span>
        <motion.div variants={itemVariants}>
          <h2>Welcome back.</h2>
          <p className="ops-copy">Sign in to continue to your VeloSupply workspace.</p>
        </motion.div>
        {import.meta.env.DEV && <motion.button
          type="button"
          className="demo-fill-button"
          variants={itemVariants}
          onClick={() => { setValue('email', 'admin@velosupply.ai'); setValue('password', 'Velo@12345') }}
        >Fill Admin Demo</motion.button>}
        <motion.label className="login-field-label" variants={itemVariants}>
          Email address
          <input className="field" type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} />
          {errors.email && <small className="form-error">{errors.email.message}</small>}
        </motion.label>
        <motion.label className="login-field-label" variants={itemVariants}>
          Password
          <span className="password-field">
            <input className="field" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" {...register('password')} />
            <button type="button" className="password-toggle" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((value) => !value)}>
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
          {errors.password && <small className="form-error">{errors.password.message}</small>}
        </motion.label>
        {error && <motion.p role="alert" className="form-error login-alert" variants={itemVariants}>{error}</motion.p>}
        <motion.button className="button ops-button login-submit" disabled={isSubmitting} variants={itemVariants}>
          {isSubmitting ? 'Authenticating…' : 'Sign in to console'}
        </motion.button>
        <motion.p className="login-register-link" variants={itemVariants}>
          New to VeloSupply? <Link to="/register">Create an account</Link>
        </motion.p>
      </motion.form>
    </section>
  </main>
}
