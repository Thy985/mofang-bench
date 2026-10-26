import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'

function Placeholder({ title }: { title: string }) {
  return <h1 className="text-2xl font-semibold">{title}</h1>
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="providers" element={<Placeholder title="Providers" />} />
        <Route path="benchmarks" element={<Placeholder title="Benchmarks" />} />
        <Route
          path="benchmarks/:id"
          element={<Placeholder title="Benchmark Detail" />}
        />
        <Route path="runs" element={<Placeholder title="Runs" />} />
        <Route path="runs/new" element={<Placeholder title="New Run" />} />
        <Route path="runs/:id" element={<Placeholder title="Run" />} />
        <Route path="episodes/:id" element={<Placeholder title="Episode" />} />
      </Route>
    </Routes>
  )
}
