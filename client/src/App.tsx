import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Boxes, CircleAlert, LoaderCircle, Plus, Search, X } from 'lucide-react'
import { ApiError, createProduct, getProduct, getProducts, recordMovement, type Movement, type Product } from './api'
import './App.css'

const formatDate = (value: string) => new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

function AppHeader() {
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Stockroom home">
        <span className="brand-mark"><Boxes size={19} strokeWidth={2.2} /></span>
        <span>stockroom<span className="brand-period">.</span></span>
      </Link>
      <div className="topbar-context"><span className="status-dot" /><span>WAREHOUSE 01</span></div>
    </header>
  )
}

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <AppHeader />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<ProductListPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <footer className="app-footer"><span>STOCKROOM</span><span>Movement-led inventory</span></footer>
      </div>
    </BrowserRouter>
  )
}

function ProductListPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [adding, setAdding] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const reloadProducts = () => {
    setLoading(true)
    setLoadError('')
    setReloadToken((value) => value + 1)
  }

  useEffect(() => {
    const controller = new AbortController()
    getProducts(search, lowStockOnly, controller.signal)
      .then(setProducts)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load products.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [search, lowStockOnly, reloadToken])

  const handleCreated = () => {
    setAdding(false)
    reloadProducts()
  }

  const lowStockCount = products.filter((product) => product.stock <= product.reorderThreshold).length

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">INVENTORY / OVERVIEW</p>
          <h1>Products<span className="heading-count">{products.length.toString().padStart(2, '0')}</span></h1>
          <p className="page-description">A live view of what is on your shelves.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setAdding(true)}><Plus size={17} /> Add product</button>
      </section>

      <section className="inventory-toolbar" aria-label="Product filters">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <span className="visually-hidden">Search by product name or SKU</span>
          <input value={search} onChange={(event) => { setLoading(true); setLoadError(''); setSearch(event.target.value) }} placeholder="Search name or SKU" />
          {search && <button className="icon-button clear-search" type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}
        </label>
        <label className="filter-toggle">
          <input type="checkbox" checked={lowStockOnly} onChange={(event) => { setLoading(true); setLoadError(''); setLowStockOnly(event.target.checked) }} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span>Low stock</span><span className="filter-count">{lowStockCount}</span>
        </label>
        <span className="result-count">{loading ? 'Updating…' : `${products.length} ${products.length === 1 ? 'item' : 'items'}`}</span>
      </section>

      <section className="table-wrap" aria-label="Products">
        <div className="table-scroll">
          <table className="product-table">
            <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col" className="numeric-cell">Reorder at</th><th scope="col" className="numeric-cell">In stock</th><th scope="col"><span className="visually-hidden">Stock status</span></th></tr></thead>
            <tbody>
              {loading && products.length === 0 && <tr><td colSpan={5}><LoadingState label="Loading inventory" /></td></tr>}
              {!loading && loadError && <tr><td colSpan={5}><ErrorState message={loadError} onRetry={reloadProducts} /></td></tr>}
              {!loading && !loadError && products.length === 0 && <tr><td colSpan={5}><EmptyProducts hasSearch={Boolean(search || lowStockOnly)} onAdd={() => setAdding(true)} /></td></tr>}
              {products.map((product) => {
                const isLow = product.stock <= product.reorderThreshold
                return (
                  <tr key={product.id} className={isLow ? 'product-row is-low' : 'product-row'}>
                    <td><Link to={`/products/${product.id}`} className="product-link"><span className="product-monogram">{product.name.trim().charAt(0).toUpperCase()}</span><span className="product-name">{product.name}</span></Link></td>
                    <td><span className="sku-value">{product.sku}</span></td>
                    <td className="numeric-cell muted-cell">{product.reorderThreshold} units</td>
                    <td className="numeric-cell stock-number">{product.stock}<span className="unit-label"> units</span></td>
                    <td className="status-cell">{isLow ? <span className="stock-badge"><span />Reorder</span> : <span className="healthy-mark" aria-label="Stock healthy">OK</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="table-legend"><span><i className="legend-dot legend-low" />At or below reorder threshold</span><span>Stock calculated from movement history</span></div>
      </section>

      {adding && <ProductDialog onClose={() => setAdding(false)} onCreated={handleCreated} />}
    </>
  )
}

function ProductDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [threshold, setThreshold] = useState('0')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const errors: Record<string, string> = {}
    if (!sku.trim()) errors.sku = 'Enter a SKU.'
    if (!name.trim()) errors.name = 'Enter a product name.'
    if (!Number.isInteger(Number(threshold)) || Number(threshold) < 0) errors.reorderThreshold = 'Enter a non-negative whole number.'
    setFieldErrors(errors)
    setFormError('')
    if (Object.keys(errors).length) return

    setSaving(true)
    try {
      await createProduct({ sku: sku.trim(), name: name.trim(), reorderThreshold: Number(threshold) })
      onCreated()
    } catch (error) {
      if (error instanceof ApiError && error.field) setFieldErrors({ [error.field]: error.message })
      else setFormError(error instanceof Error ? error.message : 'Could not create product.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="product-dialog-title">
        <div className="modal-heading"><div><p className="eyebrow">NEW RECORD</p><h2 id="product-dialog-title">Add a product</h2></div><button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>
        <form onSubmit={submit} noValidate>
          <FormField label="SKU" error={fieldErrors.sku}><input autoFocus value={sku} onChange={(event) => setSku(event.target.value)} aria-invalid={Boolean(fieldErrors.sku)} aria-describedby={fieldErrors.sku ? 'sku-error' : undefined} placeholder="e.g. WH-2048" /></FormField>
          <FormField label="Product name" error={fieldErrors.name}><input value={name} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'product-name-error' : undefined} placeholder="e.g. Canvas tote" /></FormField>
          <FormField label="Reorder threshold" hint="Alert when stock reaches this level" error={fieldErrors.reorderThreshold}><input type="number" min="0" step="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} aria-invalid={Boolean(fieldErrors.reorderThreshold)} aria-describedby={fieldErrors.reorderThreshold ? 'reorderThreshold-error' : undefined} /></FormField>
          {formError && <p className="form-error form-error-summary" role="alert">{formError}</p>}
          <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{saving ? 'Saving…' : 'Create product'}</button></div>
        </form>
      </section>
    </div>
  )
}

function ProductDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [type, setType] = useState<'in' | 'out'>('in')
  const [quantity, setQuantity] = useState('1')
  const [note, setNote] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const retryProduct = () => {
    setLoading(true)
    setLoadError('')
    setReloadToken((value) => value + 1)
  }

  useEffect(() => {
    const controller = new AbortController()
    getProduct(id, controller.signal)
      .then((result) => { setProduct(result.product); setMovements(result.movements) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load this product.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, reloadToken])

  const submitMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = Number(quantity)
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setFieldError('Enter a positive whole number.')
      setFormError('')
      return
    }
    setFieldError('')
    setFormError('')
    setSaving(true)
    try {
      const result = await recordMovement(id, { type, quantity: amount, note: note.trim() || undefined })
      setProduct((current) => current ? { ...current, stock: result.stock } : current)
      setMovements((current) => [result.movement, ...current])
      setQuantity('1')
      setNote('')
    } catch (error) {
      if (error instanceof ApiError && error.field === 'quantity') setFieldError(error.message)
      else setFormError(error instanceof Error ? error.message : 'Could not record this movement.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !product) return <LoadingState label="Loading product" />
  if (loadError && !product) return <ErrorState message={loadError} onRetry={retryProduct} />
  if (!product) return null

  const isLow = product.stock <= product.reorderThreshold
  return (
    <>
      <button className="back-link" type="button" onClick={() => navigate('/')}><ArrowLeft size={16} /> All products</button>
      <section className="detail-heading">
        <div><p className="eyebrow">PRODUCT RECORD / {product.sku}</p><h1>{product.name}</h1><p className="page-description">Added {formatDate(product.createdAt)}</p></div>
        {isLow ? <span className="stock-badge detail-badge"><span />Reorder needed</span> : <span className="healthy-pill">Stock healthy</span>}
      </section>

      <section className="detail-grid">
        <div className="detail-main">
          <section className="stock-panel" aria-label="Current stock">
            <div><p className="eyebrow">CURRENT STOCK</p><p className="stock-total">{product.stock}<span> units</span></p></div>
            <div className="stock-meta"><span>Reorder threshold</span><strong>{product.reorderThreshold} units</strong></div>
            <div className="stock-meta"><span>SKU</span><strong>{product.sku}</strong></div>
          </section>
          <section className="history-section">
            <div className="section-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Movement history</h2></div><span className="history-count">{movements.length.toString().padStart(2, '0')} ENTRIES</span></div>
            {movements.length === 0 ? <div className="history-empty">No movements yet. Record the first stock change to start the history.</div> : <ol className="movement-list">{movements.map((movement) => <MovementRow key={movement.id} movement={movement} />)}</ol>}
          </section>
        </div>

        <aside className="movement-panel">
          <div className="section-heading"><div><p className="eyebrow">INVENTORY EVENT</p><h2>Record movement</h2></div></div>
          <form onSubmit={submitMovement} noValidate>
            <div className="field-group"><span className="field-label">Direction</span><div className="segmented-control" role="group" aria-label="Movement type">
              <button type="button" className={type === 'in' ? 'segment active' : 'segment'} onClick={() => setType('in')}><ArrowDownLeft size={16} /> Stock in</button>
              <button type="button" className={type === 'out' ? 'segment active' : 'segment'} onClick={() => setType('out')}><ArrowUpRight size={16} /> Stock out</button>
            </div></div>
            <FormField label="Quantity" hint={`Available: ${product.stock} units`} error={fieldError}><input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? 'quantity-error' : undefined} /></FormField>
            <FormField label="Note" hint="Optional · max 500 characters"><textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for this movement" /></FormField>
            {formError && <p className="form-error form-error-summary" role="alert">{formError}</p>}
            <button className="button button-primary button-wide" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : type === 'in' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}{saving ? 'Recording…' : `Record stock ${type}`}</button>
          </form>
          <p className="append-only-note">Movements are permanent audit records.</p>
        </aside>
      </section>
    </>
  )
}

function MovementRow({ movement }: { movement: Movement }) {
  const isIn = movement.type === 'in'
  return <li className="movement-row"><span className={isIn ? 'movement-icon movement-in' : 'movement-icon movement-out'}>{isIn ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div className="movement-copy"><strong>Stock {isIn ? 'received' : 'removed'}</strong><span>{formatDate(movement.createdAt)}{movement.note ? ` · ${movement.note}` : ''}</span></div><strong className={isIn ? 'movement-quantity quantity-in' : 'movement-quantity quantity-out'}>{isIn ? '+' : '-'}{movement.quantity}</strong></li>
}

function FormField({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const errorId = label === 'Reorder threshold' ? 'reorderThreshold-error' : label === 'Quantity' ? 'quantity-error' : `${label.toLowerCase().replaceAll(' ', '-')}-error`
  return <label className="field-group"><span className="field-label-row"><span className="field-label">{label}</span>{hint && <span className="field-hint">{hint}</span>}</span>{children}{error && <span className="field-error" id={errorId} role="alert"><CircleAlert size={14} />{error}</span>}</label>
}

function LoadingState({ label }: { label: string }) {
  return <div className="state-message"><LoaderCircle className="spin" size={20} /><span>{label}</span></div>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="state-message state-error"><CircleAlert size={20} /><span>{message}</span><button className="text-button" type="button" onClick={onRetry}>Try again</button></div>
}

function EmptyProducts({ hasSearch, onAdd }: { hasSearch: boolean; onAdd: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><Boxes size={22} /></span><h2>{hasSearch ? 'No matching products' : 'Nothing on the shelves yet'}</h2><p>{hasSearch ? 'Try a different search or clear the low-stock filter.' : 'Add your first product to start tracking inventory.'}</p>{!hasSearch && <button className="button button-primary" type="button" onClick={onAdd}><Plus size={16} /> Add a product</button>}</div>
}

function NotFound() {
  return <div className="state-message state-error"><CircleAlert size={20} /><span>This page does not exist.</span><Link className="text-button" to="/">Return to products</Link></div>
}

export default App