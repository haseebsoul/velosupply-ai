import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, errorMessage } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import type { User } from '../types'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(100, 'Name is too long'),
  email: z.string().trim().email('Enter a valid email address').max(254),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
  confirmPassword: z.string(),
  role: z.enum(['user', 'operator', 'admin']),
  inviteCode: z.string().optional(),
}).superRefine((values, context) => {
  if (values.password !== values.confirmPassword) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match' })
  }
  if (values.role !== 'user' && !values.inviteCode?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['inviteCode'], message: 'An invitation code is required for this stakeholder type' })
  }
})

type Fields = z.infer<typeof schema>

const stakeholderOptions = [
  { role: 'user' as const, title: 'Buyer', description: 'Browse the catalog and manage purchases' },
  { role: 'operator' as const, title: 'Operations', description: 'Coordinate stock and fulfilment' },
  { role: 'admin' as const, title: 'Administrator', description: 'Manage workspace access and controls' },
]

export function RegistrationPage() {
  const navigate = useNavigate()
  const setSession = useAppStore((state) => state.setSession)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'user', name: '', email: '', password: '', confirmPassword: '', inviteCode: '' },
  })
  const selectedRole = watch('role')

  const submit = async (values: Fields) => {
    setError('')
    try {
      const { confirmPassword, inviteCode, ...payload } = values
      const { data } = await api.post<{ token: string; user: User }>('/auth/register', {
        ...payload,
        inviteCode: inviteCode?.trim() || undefined,
      })
      setSession(data.token, data.user)
      navigate('/dashboard', { replace: true })
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return <main className="login-screen registration-screen">
    <section className="login-art">
      <div className="login-art-copy">
        <Link className="brand" to="/" style={{ color: 'var(--text-ops-primary)' }}><span className="brand-mark">V</span> VeloSupply AI</Link>
        <span className="mono-label registration-eyebrow">Stakeholder access</span>
        <h1>One supply network. Clear ownership at every step.</h1>
        <p className="ops-muted">Choose the account type that matches the work you do with VeloSupply</p>
      </div>
    </section>
    <section className="login-form-wrap">
      <form className="login-form registration-form" onSubmit={handleSubmit(submit)} noValidate>
        <div className="registration-heading"><span className="mono-label">Create workspace access</span><h2>Create your account</h2><p className="ops-copy">Select a stakeholder role and add your details</p></div>
        <div className="stakeholder-options" role="group" aria-label="Choose stakeholder type">
          {stakeholderOptions.map((option) => <button
            key={option.role}
            type="button"
            className={`stakeholder-option ${selectedRole === option.role ? 'selected' : ''}`}
            aria-pressed={selectedRole === option.role}
            onClick={() => setValue('role', option.role, { shouldValidate: true, shouldDirty: true })}
          >
            <strong>{option.title}</strong><span>{option.description}</span>
            {option.role !== 'user' && <small>Invitation required</small>}
          </button>)}
        </div>
        <input type="hidden" {...register('role')} />
        <label className="form-field">Full name<input className="field" autoComplete="name" {...register('name')} /></label>
        {errors.name && <small className="field-error">{errors.name.message}</small>}
        <label className="form-field">Work email<input className="field" type="email" autoComplete="email" {...register('email')} /></label>
        {errors.email && <small className="field-error">{errors.email.message}</small>}
        <label className="form-field">Password<div className="password-input"><input className="field" type={visible ? 'text' : 'password'} autoComplete="new-password" {...register('password')} /><button type="button" className="password-toggle" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        {errors.password && <small className="field-error">{errors.password.message}</small>}
        <label className="form-field">Confirm password<input className="field" type="password" autoComplete="new-password" {...register('confirmPassword')} /></label>
        {errors.confirmPassword && <small className="field-error">{errors.confirmPassword.message}</small>}
        {selectedRole !== 'user' && <>
          <label className="form-field">Invitation code<input className="field" type="password" autoComplete="off" {...register('inviteCode')} /></label>
          {errors.inviteCode && <small className="field-error">{errors.inviteCode.message}</small>}
        </>}
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="button ops-button registration-submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create account'}</button>
        <p className="registration-footer">Already registered? <Link to="/login">Sign in</Link></p>
      </form>
    </section>
  </main>
}
