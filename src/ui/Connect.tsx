'use client'

// Real wallet connection (wagmi, injected wallets found via EIP-6963: MetaMask, Rabby, Brave, Coinbase extension…).
// Browser wallets cannot sign EIP-8141 frame transactions yet, so on this devnet every send is signed by the shared
// demo account. The connected wallet is shown for identity only, and the card says so.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http, injected, useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { defineChain } from 'viem'
import { ETHREX } from '../rpc'
import { DEPLOY } from './deploy'

const devnet = defineChain({
  id: 1337,
  name: 'Alt-mempool devnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ETHREX] } },
})
const config = createConfig({ chains: [devnet], connectors: [injected()], transports: { [devnet.id]: http() } })
const queryClient = new QueryClient()
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

export function Connect() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectCard />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

function ConnectCard() {
  const { address, isConnected, connector } = useConnection()
  const connectors = useConnectors()
  const { mutate: connect, isPending, error, variables } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  // Installed wallets announce themselves (EIP-6963). Show those; fall back to the generic injected one.
  const named = connectors.filter((c) => c.id !== 'injected')
  const options = named.length ? named : connectors

  return (
    <section className="connect" aria-label="Connect wallet">
      <div className="connect-head">
        <h3>Wallet</h3>
        {isConnected ? (
          <span className="connect-who">
            <span className="dot pass" aria-hidden="true" />
            Connected <code>{short(address)}</code>
            {connector?.name ? <span className="muted"> · {connector.name}</span> : null}
            <button type="button" onClick={() => disconnect()}>
              Disconnect
            </button>
          </span>
        ) : (
          <span className="connect-options">
            {options.map((c) => (
              <button key={c.uid} type="button" className="primary" disabled={isPending} onClick={() => connect({ connector: c })}>
                {isPending && variables?.connector === c ? 'Connecting…' : c.id === 'injected' ? 'Connect wallet' : `Connect ${c.name}`}
              </button>
            ))}
          </span>
        )}
      </div>
      {error && !isConnected && (
        <p className="error" role="alert">
          {/provider not found|not found/i.test(error.message)
            ? 'No browser wallet found. Install MetaMask or Rabby, or use the demo account below without connecting.'
            : `${error.message.split('\n')[0]}. Try again, or use the demo account below.`}
        </p>
      )}
      <p className="muted connect-note">
        {isConnected ? 'Your wallet is connected. ' : ''}
        Browser wallets can't sign EIP-8141 frame transactions yet, so on this devnet sends are signed by the shared demo account{' '}
        <code>{short(DEPLOY.demoWallet)}</code>. It holds test tUSD and 0 ETH.
      </p>
    </section>
  )
}
