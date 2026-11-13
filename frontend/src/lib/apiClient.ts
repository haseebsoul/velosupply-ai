import axios from 'axios'

export const api = axios.create({ baseURL: '/api', timeout: 10000 })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('velosupply-token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(error),
)

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error ?? error.response?.data?.message
    return typeof message === 'string' ? message : error.message
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred'
}
