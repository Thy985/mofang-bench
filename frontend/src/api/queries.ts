import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export const qk = {
  providers: ['providers'] as const,
  benchmarks: ['benchmarks'] as const,
  benchmark: (id: string) => ['benchmark', id] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['run', id] as const,
  snapshot: (id: string) => ['snapshot', id] as const,
  episode: (id: string) => ['episode', id] as const,
  steps: (id: string) => ['steps', id] as const,
  report: (id: string) => ['report', id] as const,
  compare: (first: string, second: string) =>
    ['compare', first, second] as const,
}

export function useProviders() {
  return useQuery({ queryKey: qk.providers, queryFn: api.providers.list })
}

export function useBenchmarks() {
  return useQuery({ queryKey: qk.benchmarks, queryFn: api.benchmarks.list })
}

export function useBenchmark(id: string | undefined) {
  return useQuery({
    queryKey: qk.benchmark(id ?? ''),
    queryFn: () => api.benchmarks.get(id!),
    enabled: Boolean(id),
  })
}

export function useRuns() {
  return useQuery({ queryKey: qk.runs, queryFn: api.runs.list })
}

export function useRun(id: string | undefined) {
  return useQuery({
    queryKey: qk.run(id ?? ''),
    queryFn: () => api.runs.get(id!),
    enabled: Boolean(id),
  })
}

export function useSnapshot(id: string | undefined) {
  return useQuery({
    queryKey: qk.snapshot(id ?? ''),
    queryFn: () => api.runs.snapshot(id!),
    enabled: Boolean(id),
  })
}

export function useEpisode(id: string | undefined) {
  return useQuery({
    queryKey: qk.episode(id ?? ''),
    queryFn: () => api.episodes.get(id!),
    enabled: Boolean(id),
  })
}

export function useSteps(id: string | undefined) {
  return useQuery({
    queryKey: qk.steps(id ?? ''),
    queryFn: () => api.episodes.steps(id!),
    enabled: Boolean(id),
  })
}

export function useReport(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.report(id ?? ''),
    queryFn: () => api.runs.report(id!),
    enabled: Boolean(id) && enabled,
  })
}

export function useCompare(runIds: [string, string] | null) {
  return useQuery({
    queryKey: qk.compare(runIds?.[0] ?? '', runIds?.[1] ?? ''),
    queryFn: () => api.compare.get(runIds!),
    enabled: runIds !== null,
  })
}
