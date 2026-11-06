'use client'

// Top-right of the header: the tUSD faucet, then RainbowKit's Connect button. Providers.tsx holds the wallet config.
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Faucet } from './Faucet'

export function HeaderWallet() {
  return (
    <div className="hdr-actions">
      <Faucet />
      <ConnectButton
        label="Connect wallet"
        chainStatus="none"
        showBalance={false}
        accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
      />
    </div>
  )
}
