import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { poetryApi } from './server/poetry-api'

export default defineConfig({
  plugins: [react(), poetryApi()],
  test: { environment: 'node' },
})
