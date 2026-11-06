// Offline self-check for send-status mapping. Run: node src/rpc.check.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { txStage } from './rpc.ts'

const load = (name: string) => JSON.parse(readFileSync(new URL(`./samples/${name}.json`, import.meta.url), 'utf8'))
assert.equal(txStage(null), 'pending') // not seen yet
assert.equal(txStage(load('bad-signature').tx), 'rejected')
assert.equal(txStage(load('reverted-out-of-gas').tx), 'failed') // included, but execution reverted
assert.equal(txStage(load('logic-revert').tx), 'failed')
const live = { hash: '0x', admission: { outcome: 'accepted', checks: [] }, entry: { status: 'New', tx: { frames: [] } } }
assert.equal(txStage(live), 'admitted')
assert.equal(txStage({ ...live, entry: { ...live.entry, status: 'OnChain' } }), 'included')
assert.equal(txStage({ ...live, entry: { ...live.entry, status: 'Cancelled' } }), 'dropped')
console.log('rpc: send-status mapping OK')
