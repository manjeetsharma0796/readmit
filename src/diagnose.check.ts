// Self-check on real devnet cases. Run: node src/diagnose.check.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { diagnose } from './diagnose.ts'

const load = (name: string) => JSON.parse(readFileSync(new URL(`./samples/${name}.json`, import.meta.url), 'utf8'))

const oog = load('reverted-out-of-gas')
const a = diagnose(oog.tx, oog.receipt)
assert.equal(a.findings[0].title, 'Frame 4 ran out of gas')
assert.match(a.findings[0].fix!, /38,000/)
assert.equal(a.mempool.tone, 'pass')
assert.equal(a.chain.tone, 'fail')

const cap = load('verify-gas-over-cap')
const b = diagnose(cap.tx, cap.receipt)
assert.equal(b.findings[0].title, 'Validation gas is over the mempool cap')
assert.equal(b.spec.headline, 'Admissible if staked')
assert.equal(b.mempool.tone, 'fail')

const sig = load('bad-signature')
const c = diagnose(sig.tx, sig.receipt)
assert.equal(c.findings[0].frame, 0)
assert.equal(c.findings[0].selector, '0x5cd5d233')

const fee = load('replacement-fee-too-low')
assert.equal(diagnose(fee.tx, fee.receipt).spec.headline, 'Not a validity rule')

console.log('diagnose: 4 cases OK')
