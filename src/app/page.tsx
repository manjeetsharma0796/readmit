'use client'

import dynamic from 'next/dynamic'

// App reads location, localStorage and the network on first render, so it renders in the browser only.
const App = dynamic(() => import('../App'), { ssr: false })

export default function Page() {
  return <App />
}
