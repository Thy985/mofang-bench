import { NavLink, Outlet } from 'react-router-dom'
import { motion } from 'motion/react'
import { ToastProvider } from '../ui/Toast'

const links = [
  { to: '/providers', label: 'Providers' },
  { to: '/benchmarks', label: 'Benchmarks' },
  { to: '/runs', label: 'Runs' },
  { to: '/runs/new', label: 'New Run' },
]

export function Layout() {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas text-text-strong">
        <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
            <span className="flex items-center gap-2 text-lg font-semibold tracking-wide">
              <span
                aria-hidden
                className="grid h-4 w-4 grid-cols-2 gap-px overflow-hidden rounded-[3px] bg-line"
              >
                <span className="bg-accent" />
                <span className="bg-warning" />
                <span className="bg-danger" />
                <span className="bg-sky-500" />
              </span>
              mofang
            </span>
            <nav className="flex gap-1 text-sm">
              {links.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `relative rounded-md px-2.5 py-1.5 transition-colors duration-fast ${
                      isActive
                        ? 'text-accent'
                        : 'text-text-dim hover:bg-surface hover:text-text'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {label}
                      {isActive && (
                        <motion.span
                          layoutId="nav-underline"
                          className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-accent"
                          transition={{
                            type: 'spring',
                            stiffness: 500,
                            damping: 40,
                          }}
                        />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>
        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          className="mx-auto max-w-7xl px-6 py-6"
        >
          <Outlet />
        </motion.main>
      </div>
    </ToastProvider>
  )
}
