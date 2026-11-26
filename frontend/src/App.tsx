import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Spinner } from './ui/Spinner'

const BenchmarkDetailPage = lazy(() => import('./pages/BenchmarkDetailPage'))
const BenchmarksPage = lazy(() => import('./pages/BenchmarksPage'))
const ComparePage = lazy(() => import('./pages/ComparePage'))
const EpisodePage = lazy(() => import('./pages/EpisodePage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const NewRunPage = lazy(() => import('./pages/NewRunPage'))
const ProvidersPage = lazy(() => import('./pages/ProvidersPage'))
const RunPage = lazy(() => import('./pages/RunPage'))
const RunsPage = lazy(() => import('./pages/RunsPage'))

export default function App() {
  const suspense = (node: React.ReactNode) => (
    <Suspense fallback={<Spinner className="mx-auto mt-8" />}>{node}</Suspense>
  )
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="providers" element={suspense(<ProvidersPage />)} />
        <Route path="benchmarks" element={suspense(<BenchmarksPage />)} />
        <Route
          path="benchmarks/:id"
          element={suspense(<BenchmarkDetailPage />)}
        />
        <Route path="runs" element={suspense(<RunsPage />)} />
        <Route
          path="leaderboard"
          element={suspense(<LeaderboardPage />)}
        />
        <Route path="runs/new" element={suspense(<NewRunPage />)} />
        <Route path="runs/:id" element={suspense(<RunPage />)} />
        <Route path="compare" element={suspense(<ComparePage />)} />
        <Route path="episodes/:id" element={suspense(<EpisodePage />)} />
      </Route>
    </Routes>
  )
}
