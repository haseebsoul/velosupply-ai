import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck, ShoppingBag, Truck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, errorMessage } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import { BrandEmblem } from '../components/BrandEmblem'
import type { User, UserRole } from '../types'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(100),
  email: z.string().trim().email('Enter a valid email').max(254),
  role: z.enum(['admin', 'operator', 'buyer', 'user']),
  password: z.string().min(8, 'Use at least 8 characters').max(128).regex(/[A-Z]/, 'Add at least one uppercase letter').regex(/[0-9]/, 'Add at least one number'),
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
const stakeholders: Array<{ value: UserRole; label: string; description: string; icon: LucideIcon }> = [
  { value: 'admin', label: 'Administrator', description: 'Manage people, access and workspace settings', icon: ShieldCheck },
  { value: 'operator', label: 'Operations team', description: 'Manage inventory, routing and fulfillment', icon: Truck },
  { value: 'buyer', label: 'Buyer', description: 'Browse products and track your orders', icon: ShoppingBag }
]

const rise = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } }
}

export function RegisterPage() {
  const navigate = useNavigate()
  const setSession = useAppStore((state) => state.setSession)
  const [visiblePassword, setVisiblePassword] = useState(false)
  const [error, setError] = useState('')
  const {
    register, handleSubmit, setValue, watch, clearErrors,
    formState: { errors, isSubmitting }
  } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'buyer', name: '', email: '', password: '', confirmPassword: '', registrationInviteCode: '' }
  })
  const selectedRole = watch('role')

  const chooseRole = (role: UserRole) => {
    setValue('role', role, { shouldDirty: true, shouldValidate: true })
    if (role === 'buyer' || role === 'user') {
      setValue('registrationInviteCode', '')
      clearErrors('registrationInviteCode')
    }
  }

  const submit = async (values: Fields) => {
    setError('')
    const privileged = values.role === 'admin' || values.role === 'operator'
    const payload = {
      name: values.name, email: values.email, role: values.role, password: values.password,
      ...(privileged ? { registrationInviteCode: values.registrationInviteCode?.trim() } : {})
    }
    try {
      const { data } = await api.post<{ token: string; user: User }>('/auth/register', payload)
      setSession(data.token, data.user)
      navigate(data.user.role === 'buyer' || data.user.role === 'user' ? '/store/orders' : '/dashboard', { replace: true })
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return <main className="registration-screen">
    <section className="registration-aside">
      <Link className="brand registration-brand" to="/"><BrandEmblem /> VeloSupply AI</Link>
      <div className="registration-aside-copy">
        <span className="eyebrow">ONE NETWORK. EVERY SIGNAL.</span>
        <h1>Make every part of your supply chain visible.</h1>
        <p>Connect the people who buy, plan and move the products your business depends on.</p>
      </div>
      <div className="registration-aside-foot"><span>VELOSUPPLY AI</span><span>SECURE WORKSPACE ACCESS</span></div>
    </section>
    <section className="registration-main">
      <motion.form className="registration-form" onSubmit={handleSubmit(submit)} noValidate initial="hidden" animate="visible">
        <motion.div className="registration-heading" variants={rise}>
          <span className="mono-label">CREATE YOUR ACCOUNT</span>
          <h2>Join the network.</h2>
          <p className="ops-copy">Choose the stakeholder role that matches how you work with VeloSupply.</p>
        </motion.div>

        <motion.fieldset className="stakeholder-fieldset" variants={rise}>
          <legend>Choose your role</legend>
          <div className="stakeholder-grid">
            {stakeholders.map(({ value, label, description, icon: Icon }) => <button
              key={value}
              type="button"
              className={`stakeholder-choice ${selectedRole === value ? 'active' : ''}`}
              aria-pressed={selectedRole === value}
              onClick={() => chooseRole(value)}
            >
              <span className="stakeholder-icon"><Icon size={18} /></span>
              <span className="stakeholder-label">{label}</span>
              <span className="stakeholder-description">{description}</span>
              {selectedRole === value && <span className="stakeholder-selected">Selected</span>}
            </button>)}
          </div>
        </motion.fieldset>

        <AnimatePresence initial={false}>
          {(selectedRole === 'admin' || selectedRole === 'operator') && <motion.div
            key={selectedRole}
            className="admin-invite-note"
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <ShieldCheck size={16} />
            <span>{selectedRole === 'admin' ? 'Administrator' : 'Operations team'} access is invitation-only. Obtain an active key from your workspace Administrator.</span>
          </motion.div>}
        </AnimatePresence>

        <div className="registration-fields">
          <motion.label className="registration-label" variants={rise}>Full name<input className="field" autoComplete="name" placeholder="Your name" {...register('name')} />{errors.name && <small className="form-error">{errors.name.message}</small>}</motion.label>
          <motion.label className="registration-label" variants={rise}>Work email<input className="field" type="email" autoComplete="email" placeholder="name@company.com" {...register('email')} />{errors.email && <small className="form-error">{errors.email.message}</small>}</motion.label>
          <motion.label className="registration-label" variants={rise}>Password
            <span className="password-field"><input className="field" type={visiblePassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" {...register('password')} /><button type="button" className="password-toggle" aria-label={visiblePassword ? 'Hide password' : 'Show password'} onClick={() => setVisiblePassword((value) => !value)}>{visiblePassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
            {errors.password && <small className="form-error">{errors.password.message}</small>}
          </motion.label>
          <motion.label className="registration-label" variants={rise}>Confirm password<input className="field" type="password" autoComplete="new-password" placeholder="Repeat your password" {...register('confirmPassword')} />{errors.confirmPassword && <small className="form-error">{errors.confirmPassword.message}</small>}</motion.label>
          <AnimatePresence initial={false}>
            {(selectedRole === 'admin' || selectedRole === 'operator') && <motion.label
              key={selectedRole + '-invite'}
              className="registration-label invite-field"
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            >
              {selectedRole === 'admin' ? 'Administrator invitation key' : 'Operations invitation key'}
              <input className="field" type="password" autoComplete="off" placeholder="Paste your invitation key" {...register('registrationInviteCode')} />
              {errors.registrationInviteCode && <small className="form-error">{errors.registrationInviteCode.message}</small>}
              <small className="registration-hint">Obtain an active key from your workspace Administrator.</small>
            </motion.label>}
          </AnimatePresence>
        </div>
        {error && <p role="alert" className="form-error registration-alert">{error}</p>}
        <button className="button ops-button registration-submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create account'}</button>
        <p className="registration-login">Already have an account? <Link to="/login">Sign in</Link></p>
      </motion.form>
    </section>
  </main>
}
