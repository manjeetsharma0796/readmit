# Readmit

Find out why an EIP-8141 frame transaction was rejected, and what to change.

Paste a transaction hash from the alt-mempool devnet (chain 1337). Readmit shows:

- **Three verdicts side by side:**
  - the live mempool sidecar (gateway or miner),
  - the chain itself (the ethrex receipt),
  - a partial ERC-8421 check, which covers the validation-gas budget and validation reverts.
- **What happened**, in plain language, with the failing frame and a concrete fix. Example: "frame 4 used 29,925 of 30,000 gas, so raise it to about 38,000".
- **Frames in execution order.** Each frame shows its role, its target, the decoded call and a gas-used vs gas-limit bar.
- **Every admission rule the sidecar ran**, plus a downloadable JSON report.
- **The latest admissions from the node.** Click any of them to inspect it.

It runs entirely in the browser. It talks directly to the sidecar and ethrex RPCs, which allow CORS from any origin, and to the sourcify signature database for decoding 4-byte selectors. There is no backend, and it uses no keys and no analytics.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
node src/diagnose.check.ts   # self-check on 4 real devnet cases
```

Share a result with `?tx=<hash>&node=gateway|miner`.

## Files

| File | What |
|---|---|
| `src/diagnose.ts` | Pure diagnosis engine: admission report + receipt in, findings + 3 verdicts out |
| `src/rpc.ts` | Devnet endpoints, `skandha_explorer_*`, `eth_getTransactionReceipt`, selector lookup |
| `src/App.tsx` | UI |
| `src/samples/*.json` | 4 real devnet cases (out of gas, validation gas over cap, bad signature, replacement fee too low). These work offline. |

## Contracts (`contracts/`)

Foundry project. `V4PricedPaymaster` lets a user pay gas in tUSD: its VERIFY frame reads the Uniswap v4 pool price (`StateLibrary.getSlot0`), and the next SENDER frame must pay at least `quote()` tUSD. Nothing is deployed yet.

```bash
cd contracts
forge install uniswap/v4-core@main     # must be @main; the v4.0.0 tag does not compile with this kit
npm i @forshtat/hegota-support@0.0.1   # EIP-8141 opcodes for Solidity
forge test --fork-url https://altmempool.forshtat.com
```

| File | What |
|---|---|
| `src/V4PricedPaymaster.sol` | The paymaster: v4-priced gas in tUSD, plus a stake forwarder for the alt-mempool staking registry |
| `script/SetupPool.s.sol` | Deploys tUSD, the ETH/tUSD v4 pool, liquidity and the paymaster (`SetupPool`), stakes it (`StakePaymaster`), and moves the price (`MovePrice`) |
| `test/Quote.t.sol` | Fork test against the live devnet |

Deploy with `--skip-simulation -g 105`. Forge underestimates this devnet's state gas.

## CROPS

- **C, censorship resistance (lead).** If one mempool refuses your transaction, Readmit shows the exact rule that rejected it and what to change, so you can get it admitted through another node (gateway or miner). Readmit is a static site with no server of ours in the path, and it works with any RPC you point it at.
- **O, open source.** MIT licensed. Everything in the demo builds from this repo.
- **P, privacy.** No trackers, analytics or cookies, and fonts are self-hosted. The only third-party call is the Sourcify signature lookup that decodes 4-byte selectors.
- **S, security.** Keys are made and kept in the browser and are test-only. Every send is dry-run with `ethrex_simulateFrameTransaction` before you sign, so you don't pay for a transaction that is going to fail.

**Trade-offs.**
- Calling RPCs straight from the browser means those RPCs see your IP address.
- The selector lookup tells Sourcify which selectors you decoded.
- Keys held in the browser are fine on a test network and not acceptable for real funds.
- The ERC-8421 check is partial: it covers the validation-gas budget and validation reverts, not the full rule set.

## Not built yet

- Pasting raw transaction bytes and simulating before sending (`ethrex_simulateFrameTransaction`).
- Fix and resend.
- Stake helper.
- The full ERC-8421 rule set.
- Fuzzing and minimisation.

## Licence

MIT
