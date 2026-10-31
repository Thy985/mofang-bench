import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'

type ToastTone = 'success' | 'error'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++
    setToasts((list) => [...list.slice(-3), { id, tone, message }])
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id))
    }, 4000)
  }, [])
  const api = {
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message),
  }
  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          <AnimatePresence>
            {toasts.map((toast) => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                data-testid="toast"
                role="status"
                className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg ${
                  toast.tone === 'success'
                    ? 'border-accent-dim bg-emerald-950/90 text-emerald-200'
                    : 'border-danger bg-rose-950/90 text-rose-200'
                }`}
              >
                {toast.message}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
