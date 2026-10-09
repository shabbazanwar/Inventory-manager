export interface Product {
  id: number | string
  sku: string
  name: string
  reorderThreshold: number
  createdAt: string
  stock: number
}

export interface Movement {
  id: number | string
  productId: number | string
  type: 'in' | 'out'
  quantity: number
  note: string | null
  createdAt: string
}

interface ApiErrorPayload {
  code: string
  message: string
  field?: string
  details?: { available?: number }
}

export class ApiError extends Error {
  code: string
  field?: string
  details?: { available?: number }

  constructor(payload: ApiErrorPayload) {
    super(payload.message)
    this.name = 'ApiError'
    this.code = payload.code
    this.field = payload.field
    this.details = payload.details
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error: ApiErrorPayload = payload?.error ?? {
      code: 'REQUEST_FAILED',
      message: 'The request could not be completed.',
    }
    throw new ApiError(error)
  }
  return payload.data as T
}

export async function getProducts(search: string, lowStock: boolean, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (search.trim()) params.set('search', search.trim())
  if (lowStock) params.set('lowStock', 'true')
  const suffix = params.size ? `?${params.toString()}` : ''
  const result = await request<{ products: Product[] }>(`/products${suffix}`, { signal })
  return result.products
}

export async function createProduct(input: { sku: string; name: string; reorderThreshold: number }) {
  const result = await request<{ product: Product }>('/products', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.product
}

export async function getProduct(id: string, signal?: AbortSignal) {
  return request<{ product: Product; movements: Movement[] }>(`/products/${encodeURIComponent(id)}`, { signal })
}

export async function recordMovement(id: string, input: { type: 'in' | 'out'; quantity: number; note?: string }) {
  return request<{ movement: Movement; stock: number }>(`/products/${encodeURIComponent(id)}/movements`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}