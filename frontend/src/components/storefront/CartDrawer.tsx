import { useState } from 'react'
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
  shippingRegion: z.string().min(2, 'Enter a shipping region'),
})
type CheckoutFields = z.infer<typeof checkoutSchema>

export function CartDrawer() {
  const { lines, open, setOpen, setQuantity, clear } = useCartStore()
  const [receipt, setReceipt] = useState('')
  const [checkoutError, setCheckoutError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<CheckoutFields>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { shippingRegion: 'United States' },
  })
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0)
  const submit = async (values: CheckoutFields) => {
    setCheckoutError('')
    try {
      const { data } = await api.post<{ order: { id: string } }>('/orders/checkout', {
        ...values,
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
      })
      clear()
      reset()
      setReceipt(data.order.id)
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
                <div><strong>{product.name}</strong><div className="mono-label">{product.sku} · {product.warehouse_hub}</div><div className="mono" style={{ marginTop: 7 }}>${product.price.toLocaleString()} each</div></div>
                <div className="quantity-control"><button aria-label={`Decrease ${product.name}`} onClick={() => setQuantity(product.id, quantity - 1)}><Minus size={14} /></button><span className="mono">{quantity}</span><button aria-label={`Increase ${product.name}`} disabled={quantity >= product.stock} onClick={() => setQuantity(product.id, quantity + 1)}><Plus size={14} /></button></div>
              </div>)}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '20px 0', fontWeight: 700 }}>Order total <span className="mono">${total.toLocaleString()}</span></div>
              <form onSubmit={handleSubmit(submit)} style={{ display: 'grid', gap: 12 }}>
                <label>Name<input className="field" {...register('customerName')} />{errors.customerName && <small className="danger-text">{errors.customerName.message}</small>}</label>
                <label>Email<input className="field" type="email" {...register('customerEmail')} />{errors.customerEmail && <small className="danger-text">{errors.customerEmail.message}</small>}</label>
                <label>Shipping region<input className="field" {...register('shippingRegion')} />{errors.shippingRegion && <small className="danger-text">{errors.shippingRegion.message}</small>}</label>
                {checkoutError && <p role="alert" className="danger-text">{checkoutError}</p>}
                <button className="button button-dark" disabled={isSubmitting}>{isSubmitting ? 'Securing stock…' : 'Place order'}</button>
              </form>
            </>}
        </motion.aside>
      </>}
    </AnimatePresence>
  )
}
