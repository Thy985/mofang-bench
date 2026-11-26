import { defineConfig, devices } from '@playwright/test'

const dbPath = `data/e2e-${Date.now()}.db`

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'uv run --frozen python scripts/fake_openai_server.py --port 20129 --api-key test',
      cwd: '..',
      url: 'http://127.0.0.1:20129/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `uv run --frozen mofang serve --port 8000 --db ${dbPath}`,
      cwd: '..',
      url: 'http://127.0.0.1:8000/api/benchmarks',
      reuseExistingServer: false,
      timeout: 120_000,
      // 显式清空环境变量 key：E2E 必须走 Web 里保存的 key。
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
      },
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      cwd: '.',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
