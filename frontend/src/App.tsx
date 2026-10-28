import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import BenchmarkDetailPage from './pages/BenchmarkDetailPage'
import BenchmarksPage from './pages/BenchmarksPage'
import EpisodePage from './pages/EpisodePage'
import NewRunPage from './pages/NewRunPage'
import ProvidersPage from './pages/ProvidersPage'
import RunPage from './pages/RunPage'
import RunsPage from './pages/RunsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="providers" element={<ProvidersPage />} />
        <Route path="benchmarks" element={<BenchmarksPage />} />
        <Route
          path="benchmarks/:id"
          element={<BenchmarkDetailPage />}
        />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/new" element={<NewRunPage />} />
        <Route path="runs/:id" element={<RunPage />} />
        <Route path="episodes/:id" element={<EpisodePage />} />
      </Route>
    </Routes>
  )
}
