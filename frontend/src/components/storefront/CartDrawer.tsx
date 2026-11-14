import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Minus, Plus, ShoppingCart, X } from 'lucide-react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { api, errorMessage } from '../../lib/apiClient'
import { useCartStore } from '../../store/useCartStore'

const checkoutSchema = z.object({
  customerName: z.string().min(2, 'Enter your name'),
  customerEmail: z.string().email('Enter a valid email'),
  city: z.enum(['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta']),
  address: z.string().min(5, 'Enter your delivery address'),
  paymentMethod: z.enum(['COD', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'CARD', 'BANK_TRANSFER']),
})
type CheckoutFields = z.infer<typeof checkoutSchema>

export function CartDrawer() {
  const { lines, open, setOpen, setQuantity, clear } = useCartStore()
  const [receipt, setReceipt] = useState('')
  const [checkoutError, setCheckoutError] = useState('')
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<CheckoutFields>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { city: 'Karachi', paymentMethod: 'COD' },
  })
  const money = new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })
  const total = lines.reduce((sum, line) => sum + (line.product.priceExGstPkr ?? 0) * line.quantity, 0)
  const hasUnpricedItem = lines.some((line) => !Number.isSafeInteger(line.product.priceExGstPkr))
  const submit = async (values: CheckoutFields) => {
    setCheckoutError('')
    if (hasUnpricedItem) {
      setCheckoutError('This demo product does not have a verified PKR price yet.')
      return
    }
    const payload = {
      ...values,
      items: lines.map((line) => ({ sku: line.product.sku, qty: line.quantity })),
    }
    const signature = JSON.stringify(payload)
    if (!idempotencyRef.current || idempotencyRef.current.signature !== signature) {
      idempotencyRef.current = { signature, key: crypto.randomUUID() }
    }
    try {
      const { data } = await api.post<{ order: { id: string; code: string } }>('/checkout', payload, {
        headers: { 'Idempotency-Key': idempotencyRef.current.key },
      })
      idempotencyRef.current = null
      clear()
      reset()
      setReceipt(data.order.code || data.order.id)
    } catch (error) {
      setCheckoutError(errorMessage(error))
    }
  }

  const close = () => {
    setOpen(false)
    setReceipt('')
    setCheckoutError('')
  }

  return (
    <AnimatePresence>
      {open && <>
        <motion.button className="drawer-backdrop" aria-label="Close cart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
        <motion.aside className="cart-drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} aria-label="Shopping cart">
          <div className="drawer-head"><div><span className="eyebrow">Live inventory</span><h2 style={{ margin: '5px 0' }}>{receipt ? 'Order confirmed' : 'Your cart'}</h2></div><button className="small-button" aria-label="Close cart" onClick={close}><X size={18} /></button></div>
          {receipt ? <div className="card-light" style={{ marginTop: 28 }}><span className="success-text">Inventory reserved successfully</span><h3>Thank you for your order.</h3><div className="mono-label">ORDER REFERENCE</div><div className="mono" style={{ margin: '9px 0 20px' }}>{receipt}</div><p className="muted">Your order is assigned to an optimized fulfillment hub.</p><Link className="button button-dark" to="/dashboard" onClick={close}>Watch fulfillment route</Link></div> :
          lines.length === 0 ? <div style={{ textAlign: 'center', padding: '60px 10px' }}><ShoppingCart size={32} /><p className="muted">Your cart is waiting for hardware.</p><Link className="button button-dark" to="/store" onClick={close}>Explore catalog</Link></div> :
            <>
              {lines.map(({ product, quantity }) => <div className="cart-line" key={product.id}>
                <div><strong>{product.name}</strong><div className="mono-label">{product.sku} · {product.warehouse_hub}</div><div className="mono" style={{ marginTop: 7 }}>{typeof product.priceExGstPkr === 'number' && Number.isSafeInteger(product.priceExGstPkr) ? money.format(product.priceExGstPkr) : 'PKR price not configured'} each</div></div>
                <div className="quantity-control"><button aria-label={`Decrease ${product.name}`} onClick={() => setQuantity(product.id, quantity - 1)}><Minus size={14} /></button><span className="mono">{quantity}</span><button aria-label={`Increase ${product.name}`} disabled={quantity >= (product.available ?? product.stock)} onClick={() => setQuantity(product.id, quantity + 1)}><Plus size={14} /></button></div>
              </div>)}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '20px 0', fontWeight: 700 }}>Subtotal before GST and delivery <span className="mono">{money.format(total)}</span></div>
              <form onSubmit={handleSubmit(submit)} style={{ display: 'grid', gap: 12 }}>
                <label>Name<input className="field" {...register('customerName')} />{errors.customerName && <small className="danger-text">{errors.customerName.message}</small>}</label>
                <label>Email<input className="field" type="email" {...register('customerEmail')} />{errors.customerEmail && <small className="danger-text">{errors.customerEmail.message}</small>}</label>
                <label>Delivery city<select className="field" {...register('city')}><option>Karachi</option><option>Lahore</option><option>Islamabad</option><option>Rawalpindi</option><option>Faisalabad</option><option>Multan</option><option>Peshawar</option><option>Quetta</option></select>{errors.city && <small className="danger-text">{errors.city.message}</small>}</label>
                <label>Delivery address<input className="field" {...register('address')} />{errors.address && <small className="danger-text">{errors.address.message}</small>}</label>
                <label>Payment method<select className="field" {...register('paymentMethod')}><option value="COD">Cash on delivery</option><option value="JAZZCASH">JazzCash (simulated)</option><option value="EASYPAISA">Easypaisa (simulated)</option><option value="RAAST">Raast (simulated)</option><option value="CARD">Card (simulated)</option><option value="BANK_TRANSFER">Bank transfer (simulated)</option></select>{errors.paymentMethod && <small className="danger-text">{errors.paymentMethod.message}</small>}</label>
                {checkoutError && <p role="alert" className="danger-text">{checkoutError}</p>}
                <button className="button button-dark" disabled={isSubmitting || hasUnpricedItem}>{isSubmitting ? 'Securing stock…' : 'Place order'}</button>
              </form>
            </>}
        </motion.aside>
      </>}
    </AnimatePresence>
  )
}
