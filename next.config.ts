import type { NextConfig } from 'next'

// Static export: no server, no API routes. The whole app runs in the browser (CROPS: works from any static host).
const config: NextConfig = { output: 'export' }

export default config
