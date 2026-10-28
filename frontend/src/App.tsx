import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import BenchmarkDetailPage from './pages/BenchmarkDetailPage'
import BenchmarksPage from './pages/BenchmarksPage'
import NewRunPage from './pages/NewRunPage'
import ProvidersPage from './pages/ProvidersPage'
import RunsPage from './pages/RunsPage'

function Placeholder({ title }: { title: string }) {
  return <h1 className="text-2xl font-semibold">{title}</h1>
}

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
        <Route path="runs/:id" element={<Placeholder title="Run" />} />
        <Route path="episodes/:id" element={<Placeholder title="Episode" />} />
      </Route>
    </Routes>
  )
}
