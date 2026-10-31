import { describeError } from '../lib/errors'
import type { ToastApi } from './Toast'

export function toastError(toast: ToastApi, err: unknown): void {
  toast.error(describeError(err))
}
