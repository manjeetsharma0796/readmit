import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, IBM_Plex_Mono, Schibsted_Grotesk } from 'next/font/google'
import './globals.css'

// Fonts are downloaded at build time and served with the app: no request to Google from the user's browser.
const sans = Schibsted_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' })
const display = Barlow_Condensed({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' })

const description =
  'Which frame of your EIP-8141 frame transaction failed, why, and the number to change. Dry-run, fix and resend to the ERC-8421 alt mempool, with gas paid in tUSD.'

// Link previews (ETHGlobal showcase, X, Discord). og.png is a crop of the live result page.
export const metadata: Metadata = {
  metadataBase: new URL('https://readmit-kohl.vercel.app'),
  title: 'Readmit: debug and fix frame transactions',
  description,
  icons: { icon: '/favicon.svg' },
  openGraph: { title: 'Readmit', description, images: [{ url: '/og.png', width: 1200, height: 630 }], type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Readmit', description, images: ['/og.png'] },
}

// Tell the browser the page is dark and which colour it is, so phone toolbars and the overscroll area match the page
// instead of showing a second colour once a result makes the page scroll.
export const viewport: Viewport = {
  themeColor: '#151518',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  )
}
