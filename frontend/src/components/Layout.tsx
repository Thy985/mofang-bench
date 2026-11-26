import { NavLink, Outlet } from 'react-router-dom'
import { motion } from 'motion/react'
import { ToastProvider } from '../ui/Toast'

const links = [
  { to: '/runs', label: 'Runs' },
  { to: '/runs/new', label: 'New Run' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/benchmarks', label: 'Benchmarks' },
  { to: '/providers', label: 'Providers' },
]

const MARK = [
  false,
  true,
  false,
  true,
  'accent',
  true,
  false,
  true,
  false,
] as const

export function Layout() {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas text-text-strong">
        <header className="sticky top-0 z-40 border-b border-line-soft bg-canvas/85 backdrop-blur-[14px] backdrop-saturate-150">
          <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-7 px-7 max-[1000px]:gap-3.5 max-[560px]:px-4">
            <span className="flex shrink-0 items-center gap-2.5 text-base font-[650] tracking-[0.02em]">
              <span
                aria-hidden
                className="grid h-[18px] w-[18px] rotate-[-8deg] grid-cols-3 gap-[1.5px]"
              >
                {MARK.map((cell, index) => (
                  <span
                    key={index}
                    className={
                      cell === 'accent'
                        ? 'rounded-[1px] bg-accent'
                        : cell
                          ? 'rounded-[1px] bg-[#4b5563]'
                          : 'rounded-[1px] bg-line'
                    }
                  />
                ))}
              </span>
              mofang
            </span>
            <nav
              aria-label="主导航"
              className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {links.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/runs'}
                  className={({ isActive }) =>
                    `relative shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors duration-fast ${
                      isActive
                        ? 'text-text-strong'
                        : 'text-text-dim hover:bg-surface hover:text-text-strong'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {label}
                      {isActive && (
                        <motion.span
                          layoutId="nav-underline"
                          className="absolute inset-x-2.5 -bottom-[3px] h-[1.5px] rounded-full bg-accent"
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
            <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-text-faint max-[1000px]:hidden">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_0_3px_rgba(74,222,128,0.12)]"
              />
              local
            </div>
          </div>
        </header>
        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          className="app-main"
        >
          <Outlet />
        </motion.main>
      </div>
    </ToastProvider>
  )
}
