import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Boxes, Eye, EyeOff, ShieldCheck, ShoppingBag, Truck } from 'lucide-react'
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
  password: z.string().min(8, 'Use at least 8 characters').max(128, 'Password is too long').regex(/[A-Z]/, 'Add at least one uppercase letter').regex(/[0-9]/, 'Add at least one number'),
  confirmPassword: z.string(),
  registrationInviteCode: z.string().optional()
}).superRefine((values, context) => {
  if (values.password !== values.confirmPassword) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match' })
  }
  if (!['user', 'buyer'].includes(values.role) && !values.registrationInviteCode?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['registrationInviteCode'], message: 'An invitation key is required for this role' })
  }
})

type Fields = z.infer<typeof schema>

const stakeholders: Array<{
  value: UserRole
  label: string
  description: string
  icon: LucideIcon
}> = [
  { value: 'admin', label: 'Administrator', description: 'Manage accounts, access and workspace settings', icon: ShieldCheck },
  { value: 'operator', label: 'Operations team', description: 'Manage inventory, routing and fulfillment', icon: Truck },
  { value: 'buyer', label: 'Buyer', description: 'Browse products and track orders', icon: ShoppingBag }
]

export function RegisterPage() {
  const navigate = useNavigate()
  const setSession = useAppStore((state) => state.setSession)
  const [visiblePassword, setVisiblePassword] = useState(false)
  const [error, setError] = useState('')
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'buyer', name: '', email: '', password: '', confirmPassword: '', registrationInviteCode: '' }
  })
  const selectedRole = watch('role')

  const submit = async (values: Fields) => {
    setError('')
    const payload = { name: values.name, email: values.email, role: values.role, password: values.password, ...(values.registrationInviteCode ? { registrationInviteCode: values.registrationInviteCode } : {}) }
    try {
      const { data } = await api.post<{ token: string; user: User }>('/auth/register', payload)
      setSession(data.token, data.user)
      navigate('/dashboard', { replace: true })
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return <main className="registration-screen">
    <section className="registration-aside">
      <Link className="brand registration-brand" to="/"><span className="brand-mark"><Boxes size={16} /></span> VeloSupply</Link>
      <div className="registration-aside-copy">
        <span className="mono-label">ONE NETWORK. EVERY SIGNAL.</span>
        <h1>Make every part of your supply chain visible.</h1>
        <p>Connect your team to inventory, orders and fulfillment data from one operations workspace.</p>
      </div>
      <div className="registration-aside-foot"><span>VeloSupply AI</span><span>Secure workspace access</span></div>
    </section>
    <section className="registration-main">
      <form className="registration-form" onSubmit={handleSubmit(submit)} noValidate>
        <div className="registration-heading"><span className="mono-label">CREATE YOUR ACCOUNT</span><h2>Join the network</h2><p className="ops-copy">Choose the stakeholder role that matches how you work with VeloSupply.</p></div>

        <fieldset className="stakeholder-fieldset">
          <legend>Choose your role</legend>
          <div className="stakeholder-grid">
            {stakeholders.map(({ value, label, description, icon: Icon }) => <button
              key={value}
              type="button"
              className={`stakeholder-choice ${selectedRole === value ? 'active' : ''}`}
              aria-pressed={selectedRole === value}
              onClick={() => setValue('role', value, { shouldDirty: true, shouldValidate: true })}
            ><span className="stakeholder-icon"><Icon size={18} /></span><span className="stakeholder-label">{label}</span><span className="stakeholder-description">{description}</span></button>)}
          </div>
        </fieldset>
        {selectedRole !== 'buyer' && <div className="admin-invite-note"><ShieldCheck size={16} /><span>{selectedRole === 'admin' ? 'Administrator' : 'Operations team'} access is invitation-only. Enter the private invitation key supplied by your workspace owner.</span></div>}

        <div className="registration-fields">
          <label className="registration-label">Full name<input className="field" autoComplete="name" placeholder="Your name" {...register('name')} />{errors.name && <small className="form-error">{errors.name.message}</small>}</label>
          <label className="registration-label">Work email<input className="field" type="email" autoComplete="email" placeholder="name@company.com" {...register('email')} />{errors.email && <small className="form-error">{errors.email.message}</small>}</label>
          <label className="registration-label">Password<div className="password-field"><input className="field" type={visiblePassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" {...register('password')} /><button type="button" className="password-toggle" aria-label={visiblePassword ? 'Hide password' : 'Show password'} onClick={() => setVisiblePassword((value) => !value)}>{visiblePassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>{errors.password && <small className="form-error">{errors.password.message}</small>}</label>
          <label className="registration-label">Confirm password<input className="field" type="password" autoComplete="new-password" placeholder="Repeat your password" {...register('confirmPassword')} />{errors.confirmPassword && <small className="form-error">{errors.confirmPassword.message}</small>}</label>
          {selectedRole !== 'user' && <label className="registration-label">{selectedRole === 'admin' ? 'Administrator' : 'Operations'} invitation key<input className="field" type="password" autoComplete="off" placeholder="Invitation key" {...register('registrationInviteCode')} />{errors.registrationInviteCode && <small className="form-error">{errors.registrationInviteCode.message}</small>}</label>}
        </div>
        {error && <p role="alert" className="form-error registration-alert">{error}</p>}
        <button className="button ops-button registration-submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create account'}</button>
        <p className="registration-login">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </section>
  </main>
}
