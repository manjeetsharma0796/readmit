// Offline self-check for the frame builder: build, sign, encode, decode. Run: node src/engine/frames.check.ts
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { decodeDraft, maxCostBound, sendFrames, signDraft, transferData, type Draft } from './frames.ts'

const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' // well-known local test key, no funds anywhere that matters
const me = privateKeyToAccount(key).address
const a = { tUSD: '0x1111111111111111111111111111111111111111', paymaster: '0x2222222222222222222222222222222222222222' } as const
const to = '0x3333333333333333333333333333333333333333'

const draft: Draft = { sender: me, nonce: 7n, maxFeePerGas: 4_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, frames: sendFrames(a, to, 5n * 10n ** 18n, 3_300_000n) }
const raw = await signDraft(draft, key)
assert.match(raw, /^0x06/) // type 0x06 frame transaction

const back = decodeDraft(raw)
assert.equal(back.sender.toLowerCase(), me.toLowerCase())
assert.equal(back.nonce, 7n)
assert.equal(back.frames.length, 4)
assert.deepEqual(back.frames.map((f) => [f.mode, f.flags]), [[1, 2], [1, 1], [2, 0], [2, 0]])
assert.equal(back.frames[0].target, null) // the sender verifies itself
assert.equal(back.frames[1].target?.toLowerCase(), a.paymaster)
assert.equal(back.frames[2].data, transferData(a.paymaster, 3_300_000n)) // fee frame directly follows the paymaster frame
assert.equal(back.frames[3].data, transferData(to, 5n * 10n ** 18n))
assert.deepEqual(back.frames.map((f) => [f.gas, f.stateGas]), draft.frames.map((f) => [f.gas, f.stateGas]))
assert.ok(back.frames[0].gas + back.frames[1].gas < 100_000n, 'VERIFY frames must fit the 100k validation cap')

// Fix & send path: change one limit, re-sign, and only that changes.
const fixed = { ...draft, frames: draft.frames.map((f, i) => (i === 3 ? { ...f, gas: 90_000n } : f)) }
const fixedBack = decodeDraft(await signDraft(fixed, key))
assert.equal(fixedBack.frames[3].gas, 90_000n)
assert.equal(fixedBack.frames[2].gas, draft.frames[2].gas)

// Max-cost bound covers every limit plus overhead.
assert.equal(maxCostBound(draft), (10_000n + 70_000n + 160_000n + 160_000n + 50_000n) * 4_000_000_000n)

console.log('frames: build/sign/decode OK')
