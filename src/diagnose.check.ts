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

// 0x6137…: included, frame 2 reverted after 8,158 of 50,000 gas (a logic revert), and the node lost its report.
const rev = load('logic-revert')
const d = diagnose(rev.tx, rev.receipt)
assert.equal(d.findings[0].title, 'Frame 2 reverted (not a gas problem)')
assert.match(d.findings[0].why, /8,158 of its 50,000/)
assert.match(d.findings[0].why, /raising gas won't help/)
assert.equal(d.findings[0].selector, '0x6e5141ba')
const charged = d.findings.find((f) => /charged/.test(f.title))!
assert.equal(charged.title, 'It failed on chain, and the payer was still charged')
assert.match(charged.why, /0xEe22…5Ba6 paid 0\.000482 ETH/i)
assert.equal(d.mempool.headline, 'No admission report')
assert.equal(d.chain.tone, 'fail')

// Same tx with frame 3 marked skipped (0x2), as in a failed atomic batch.
const skipped = structuredClone(rev.receipt)
skipped.frameReceipts[3].status = '0x2'
const e = diagnose(rev.tx, skipped)
const s = e.findings.find((f) => f.frame === 3)!
assert.equal(s.title, 'Frame 3 was skipped')
assert.match(s.fix!, /Fix frame 2 first/)

console.log('diagnose: 6 cases OK')
