import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck, ShoppingBag, Truck } from 'lucide-react'
import { VeloSupplyLogo } from '../components/VeloSupplyLogo'
import type { LucideIcon } from 'lucide-react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, errorMessage } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import type { User, UserRole } from '../types'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(100, 'Name is too long'),
  email: z.string().trim().email('Enter a valid email').max(254, 'Email is too long'),
  role: z.enum(['admin', 'operator', 'buyer', 'user']),
  password: z.string().min(8, 'Use at least 8 characters').max(128, 'Password is too long')
    .regex(/[A-Z]/, 'Add at least one uppercase letter')
    .regex(/[0-9]/, 'Add at least one number'),
  confirmPassword: z.string(),
  registrationInviteCode: z.string().optional()
}).superRefine((values, context) => {
  if (values.password !== values.confirmPassword) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match' })
  }
  if (values.role === 'operator' && !values.registrationInviteCode?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['registrationInviteCode'], message: 'An Operations invitation key is required' })
  }
})

type Fields = z.infer<typeof schema>

const stakeholders: Array<{
  value: UserRole
  label: string
  description: string
  icon: LucideIcon
}> = [
  { value: 'admin', label: 'Administrator', description: 'Own the catalog, access and workspace settings', icon: ShieldCheck },
  { value: 'operator', label: 'Operations team', description: 'Manage inventory, routing and fulfillment', icon: Truck },
  { value: 'buyer', label: 'Buyer', description: 'Browse hardware and track your orders', icon: ShoppingBag }
]

export function RegisterPage() {
  const navigate = useNavigate()
  const setSession = useAppStore((state) => state.setSession)
  const [visiblePassword, setVisiblePassword] = useState(false)
  const [error, setError] = useState('')
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null)
  const [bootstrapError, setBootstrapError] = useState('')
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'buyer', name: '', email: '', password: '', confirmPassword: '', registrationInviteCode: '' }
  })
  const selectedRole = watch('role')

  useEffect(() => {
    let mounted = true
    api.get<{ hasAdmin?: boolean; adminExists?: boolean }>('/auth/bootstrap-status')
      .then(({ data }) => {
        if (!mounted) return
        setHasAdmin(Boolean(data.hasAdmin ?? data.adminExists))
        setBootstrapError('')
      })
      .catch((reason) => {
        if (!mounted) return
        // Fail closed: an Admin option is never shown when the server cannot prove it is available.
        setHasAdmin(true)
        setBootstrapError(errorMessage(reason))
      })
    return () => { mounted = false }
  }, [])

  const availableStakeholders = stakeholders.filter((role) => role.value !== 'admin' || hasAdmin === false)

  const submit = async (values: Fields) => {
    setError('')
    const payload = {
      name: values.name,
      email: values.email,
      role: values.role === 'user' ? 'buyer' : values.role,
      password: values.password,
      ...(values.role === 'operator' && values.registrationInviteCode
        ? { registrationInviteCode: values.registrationInviteCode.trim() }
        : {})
    }
    try {
      const { data } = await api.post<{ token: string; user: User }>('/auth/register', payload)
      setSession(data.token, data.user)
      navigate('/dashboard', { replace: true })
    } catch (reason) {
      const message = errorMessage(reason)
      setError(message)
      if (message.includes('ADMIN_EXISTS')) {
        setHasAdmin(true)
        setValue('role', 'buyer', { shouldValidate: true })
      }
    }
  }

  return <main className="registration-screen">
    <section className="registration-aside">
      <VeloSupplyLogo size="lg" className="registration-brand" />
      <div className="registration-aside-copy">
        <span className="mono-label">SUPPLY CHAIN INTELLIGENCE · PAKISTAN</span>
        <h1>Every unit has a place. Every order has a path.</h1>
        <p>Join one connected workspace for hardware procurement, inventory operations and fulfillment.</p>
      </div>
      <div className="registration-aside-foot"><span>VeloSupply AI</span><span>Secure workspace access</span></div>
    </section>
    <section className="registration-main">
      <form className="registration-form" onSubmit={handleSubmit(submit)} noValidate>
        <div className="registration-heading">
          <span className="mono-label">CREATE YOUR ACCOUNT</span>
          <h2>Join the network</h2>
          <p className="ops-copy">Choose the role that matches how you work with VeloSupply.</p>
        </div>

        <fieldset className="stakeholder-fieldset">
          <legend>Choose your role</legend>
          <div className="stakeholder-grid">
            {availableStakeholders.map(({ value, label, description, icon: Icon }) => <button
              key={value}
              type="button"
              className={`stakeholder-choice ${selectedRole === value ? 'active' : ''}`}
              aria-pressed={selectedRole === value}
              onClick={() => {
                setValue('role', value, { shouldDirty: true, shouldValidate: true })
                setError('')
              }}
            >
              <span className="stakeholder-icon"><Icon size={18} /></span>
              <span className="stakeholder-label">{label}</span>
              <span className="stakeholder-description">{description}</span>
            </button>)}
          </div>
        </fieldset>

        {selectedRole === 'admin' && hasAdmin === false && <div className="admin-invite-note bootstrap-note">
          <ShieldCheck size={16} /><span>Initial workspace setup: Create the primary Administrator account. No invitation key is needed for the first Administrator.</span>
        </div>}
        {selectedRole === 'operator' && <div className="admin-invite-note">
          <Truck size={16} /><span>Operations access is invitation-only. Enter the single-use key provided by your workspace Administrator.</span>
        </div>}
        {selectedRole === 'buyer' && <p className="registration-open-note">Buyer registration is open. No invitation key is required.</p>}
        {hasAdmin === null && <p className="registration-open-note">Checking whether initial Administrator setup is available…</p>}
        {bootstrapError && <p role="status" className="form-error">Administrator availability could not be checked. Admin registration is hidden until the server is reachable.</p>}

        <div className="registration-fields">
          <label className="registration-label">Full name
            <input className="field" autoComplete="name" placeholder="Your name" {...register('name')} />
            {errors.name && <small className="form-error">{errors.name.message}</small>}
          </label>
          <label className="registration-label">Email address
            <input className="field" type="email" autoComplete="email" placeholder="name@company.com" {...register('email')} />
            {errors.email && <small className="form-error">{errors.email.message}</small>}
          </label>
          <label className="registration-label">Password
            <div className="password-field">
              <input className="field" type={visiblePassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters, one uppercase and one number" {...register('password')} />
              <button type="button" className="password-toggle" aria-label={visiblePassword ? 'Hide password' : 'Show password'} onClick={() => setVisiblePassword((value) => !value)}>
                {visiblePassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <small className="form-error">{errors.password.message}</small>}
          </label>
          <label className="registration-label">Confirm password
            <input className="field" type="password" autoComplete="new-password" placeholder="Repeat your password" {...register('confirmPassword')} />
            {errors.confirmPassword && <small className="form-error">{errors.confirmPassword.message}</small>}
          </label>
          {selectedRole === 'operator' && <label className="registration-label">Operations invitation key
            <input className="field" type="password" autoComplete="off" placeholder="Enter your invitation key" {...register('registrationInviteCode')} />
            {errors.registrationInviteCode && <small className="form-error">{errors.registrationInviteCode.message}</small>}
          </label>}
        </div>
        {error && <p role="alert" className="form-error registration-alert">{error}</p>}
        <button className="button ops-button registration-submit" disabled={isSubmitting || hasAdmin === null}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
        <p className="registration-login">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </section>
  </main>
}
