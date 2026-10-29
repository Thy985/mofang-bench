import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/providers', label: 'Providers' },
  { to: '/benchmarks', label: 'Benchmarks' },
  { to: '/runs', label: 'Runs' },
  { to: '/runs/new', label: 'New Run' },
]

export function Layout() {
  return (
    <div className="min-h-screen bg-canvas text-text-strong">
      <header className="border-b border-line bg-surface/80">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <span className="text-lg font-semibold tracking-wide">mofang</span>
          <nav className="flex gap-4 text-sm">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  isActive
                    ? 'font-medium text-accent'
                    : 'text-text-dim hover:text-text'
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
