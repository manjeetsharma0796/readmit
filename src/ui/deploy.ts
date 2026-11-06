import type { Address } from 'viem'
import deploy from '../../contracts/deployments/1337.json'

// Written by T04/T07 (prith). tUSD has 6 decimals on this devnet, so always format with tUSDDecimals.
export const DEPLOY = {
  tUSD: deploy.tUSD as Address,
  paymaster: deploy.paymaster as Address,
  demoWallet: deploy.demoWallet as Address,
  tUSDDecimals: deploy.tUSDDecimals,
}
