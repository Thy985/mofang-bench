import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* CSS 里的 prefers-reduced-motion 只覆盖 CSS 过渡/动画，盖不到 motion 的 JS 驱动动画，需在此统一声明 */}
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
)
