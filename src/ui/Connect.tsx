'use client'

// Top-right of the header: the demo account dropdown (balances, key, faucet), then RainbowKit's Connect button.
// Providers.tsx holds the wallet config.
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { DemoAccount } from './DemoAccount'

export function HeaderWallet() {
  return (
    <div className="hdr-actions">
      <DemoAccount />
      <ConnectButton
        label="Connect wallet"
        chainStatus="none"
        showBalance={false}
        accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
      />
    </div>
  )
}
