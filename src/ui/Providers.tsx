'use client'

// Wallet adapter for the whole page: RainbowKit on wagmi 2 (RainbowKit 2.2.11 requires wagmi ^2.9).
// Browser wallets can't sign EIP-8141 frame transactions yet, so the connected wallet is identity only and every
// send is signed by the shared demo account. The connect modal says so (appInfo.disclaimer).
import '@rainbow-me/rainbowkit/styles.css'
import { RainbowKitProvider, connectorsForWallets, darkTheme, getDefaultConfig, type DisclaimerComponent } from '@rainbow-me/rainbowkit'
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defineChain } from 'viem'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { ETHREX } from '../rpc'
import { DEPLOY } from './deploy'

export const devnet = defineChain({
  id: 1337,
  name: 'Alt-mempool devnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ETHREX] } },
  blockExplorers: { default: { name: 'Alt-mempool explorer', url: 'https://explorer.altmempool.wtf' } },
})

// A WalletConnect project id (free, cloud.reown.com) enables QR and mobile wallets. Without one, installed browser
// wallets still work: wagmi discovers them through EIP-6963 and RainbowKit lists them as installed.
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? ''
const config = projectId
  ? getDefaultConfig({ appName: 'Readmit', projectId, chains: [devnet], ssr: true })
  : createConfig({
      chains: [devnet],
      // ssr: true makes wagmi reconnect after the first render instead of during it; with it off, its Hydrate step
      // updates RainbowKit's ConnectModal mid-render and React warns ("Cannot update a component while rendering").
      ssr: true,
      transports: { [devnet.id]: http() },
      connectors: connectorsForWallets([{ groupName: 'Browser wallets', wallets: [injectedWallet] }], { appName: 'Readmit', projectId: 'none' }),
    })
const queryClient = new QueryClient()

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const Disclaimer: DisclaimerComponent = ({ Text }) => (
  <Text>
    Browser wallets can&apos;t sign EIP-8141 frame transactions yet, so on this devnet Readmit signs sends with the shared demo account {short(DEPLOY.demoWallet)}. Your
    wallet is shown for identity only and is never asked to sign.
  </Text>
)

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={devnet}
          modalSize="compact"
          appInfo={{ appName: 'Readmit', disclaimer: Disclaimer }}
          // The page is pitch black. Connect is optional (sends are signed by the demo key), so it stays quiet, not a loud primary.
          theme={{
            lightMode: darkTheme({ accentColor: '#222226', accentColorForeground: '#f4f4f5', borderRadius: 'large', overlayBlur: 'small' }),
            darkMode: darkTheme({ accentColor: '#222226', accentColorForeground: '#f4f4f5', borderRadius: 'large', overlayBlur: 'small' }),
          }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
