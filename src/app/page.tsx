'use client'

import dynamic from 'next/dynamic'

// The app (and RainbowKit) read location, localStorage and the network on first render, so it renders in the browser only.
const App = dynamic(() => import('../ClientRoot'), { ssr: false })

export default function Page() {
  return <App />
}
