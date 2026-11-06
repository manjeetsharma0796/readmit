'use client'

// The whole app under the wallet providers. Loaded with ssr:false from page.tsx: RainbowKit and the app read
// window/localStorage on first render.
import App from './App'
import { Providers } from './ui/Providers'

export default function ClientRoot() {
  return (
    <Providers>
      <App />
    </Providers>
  )
}
