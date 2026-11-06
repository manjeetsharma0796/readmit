// Pure diagnosis engine: sidecar admission report + ethrex receipt -> findings and three verdicts.
// No network here, so it can be checked offline (see diagnose.check.ts).

export type Frame = {
  mode: number
  flags: number
  target: string | null
  limits: { execution: string; state: string }
  value: string
  data: string
}
export type Check = { rule: string; verdict: 'pass' | 'fail' | 'skipped'; detail?: string; frameIndex?: number; entity?: string }
export type Admission = { outcome: string; checks: Check[]; frames?: Frame[]; frameStatuses?: string[]; errorCode?: number; at?: number; sender?: string; nonce?: string }
export type TxResult = { hash: string; entry: null | { status: string; payer?: string; sender?: string; revertReason?: string; tx: { frames: Frame[] } }; admission: Admission | null; events?: unknown[] }
export type FrameReceipt = { status: string; gasUsed: string; stateGasUsed: string; logs: unknown[] }
export type Receipt = { status: string; gasUsed: string; effectiveGasPrice: string; blockNumber: string; payer?: string; frameReceipts: FrameReceipt[] }

export type Tone = 'pass' | 'fail' | 'warn' | 'info'
export type Finding = { tone: Tone; frame?: number; title: string; why: string; fix?: string; selector?: string }
export type Verdict = { tone: Tone; headline: string; sub: string }
export type Diagnosis = { frames: Frame[]; findings: Finding[]; mempool: Verdict; chain: Verdict; spec: Verdict }

// Numbers from the sidecar's own error text and the ERC-8421 draft budget rule.
const SIDECAR_VERIFY_CAP = 100_000
const ERC8421_STAKED_CAP = 1_000_000

export const n = (hex?: string | null) => (hex ? Number(BigInt(hex)) : 0)
export const fmt = (x: number) => x.toLocaleString('en-US')
const roundUp = (x: number, step = 1000) => Math.ceil(x / step) * step

export function role(f: Frame): string {
  if (f.mode === 1) {
    const exec = (f.flags & 2) !== 0
    const pay = (f.flags & 1) !== 0
    if (exec && pay) return 'Approves execution and payment'
    if (exec) return 'Approves execution'
    if (pay) return 'Approves payment'
    return 'Verification'
  }
  if (f.mode === 2) return 'User operation'
  return 'Default call'
}
export const isVerify = (f: Frame) => f.mode === 1

export function diagnose(tx: TxResult, receipt: Receipt | null): Diagnosis {
  const adm = tx.admission
  const frames: Frame[] = tx.entry?.tx.frames ?? adm?.frames ?? []
  const findings: Finding[] = []
  const fails = (adm?.checks ?? []).filter((c) => c.verdict === 'fail')

  let spec: Verdict = { tone: 'info', headline: 'No conflict found', sub: 'Partial check: budget and validation rules only' }

  for (const c of fails) {
    const d = c.detail ?? ''
    const budget = d.match(/gas sum (\d+) \+ signature-verification cost (\d+) = (\d+) exceeds MAX_VERIFY_GAS (\d+)/)
    const vrev = d.match(/validation frame (\d+): reverted with data (0x[0-9a-fA-F]*)/)
    if (budget) {
      const total = Number(budget[3])
      const cap = Number(budget[4])
      findings.push({
        tone: 'fail',
        title: 'Validation gas is over the mempool cap',
        why: `The verification frames declare ${fmt(Number(budget[1]))} gas plus ${fmt(Number(budget[2]))} for the signature, ${fmt(total)} in total. This sidecar caps validation at ${fmt(cap)} for every account, staked or not.`,
        fix:
          total <= ERC8421_STAKED_CAP
            ? `Either lower the verification limits so the total is under ${fmt(cap)} (simulate first to see what they really use), or stake the sender. ERC-8421 lets staked entities use up to ${fmt(ERC8421_STAKED_CAP)}, but this sidecar does not apply that yet.`
            : `Lower the verification limits. ${fmt(total)} is over even the ${fmt(ERC8421_STAKED_CAP)} that ERC-8421 allows staked entities.`,
      })
      spec =
        total <= ERC8421_STAKED_CAP
          ? { tone: 'warn', headline: 'Admissible if staked', sub: `ERC-8421 allows up to ${fmt(ERC8421_STAKED_CAP)} for staked entities. The sidecar is stricter than the spec here.` }
          : { tone: 'fail', headline: 'Also rejected', sub: `Over the ${fmt(ERC8421_STAKED_CAP)} staked budget` }
    } else if (vrev) {
      const i = Number(vrev[1])
      findings.push({
        tone: 'fail',
        frame: i,
        title: `Frame ${i} rejected the transaction during validation`,
        why: `This frame's verification code (${frames[i] ? role(frames[i]).toLowerCase() : 'verification'}) reverted, so the account or paymaster refused to approve the transaction.`,
        fix: 'Check the error above. A signature error usually means the transaction was signed over the wrong hash or with the wrong key.',
        selector: vrev[2].slice(0, 10),
      })
      spec = { tone: 'fail', headline: 'Also invalid', sub: 'A revert in validation is invalid under ERC-8421 too' }
    } else if (/cannot be replaced: fee too low/.test(d)) {
      findings.push({
        tone: 'fail',
        title: 'A transaction with this nonce is already pending',
        why: 'The mempool already holds a transaction from this sender with the same nonce, and this one does not pay enough more to replace it.',
        fix: 'Raise both maxFeePerGas and maxPriorityFeePerGas above the pending transaction (bump by at least 10%), or send it with the next nonce or a new nonce key.',
      })
      spec = { tone: 'info', headline: 'Not a validity rule', sub: 'Replacement pricing is mempool policy, not part of the transaction rules' }
    } else {
      findings.push({ tone: 'fail', frame: c.frameIndex, title: `Rule "${c.rule}" failed`, why: d || 'The sidecar gave no detail for this rule.' })
      spec = { tone: 'info', headline: 'Not checked', sub: `FrameLab has no ERC-8421 mapping for "${c.rule}" yet` }
    }
  }

  // Execution results from the chain.
  if (receipt) {
    const price = n(receipt.effectiveGasPrice)
    receipt.frameReceipts.forEach((fr, i) => {
      const f = frames[i]
      if (!f) return
      const used = n(fr.gasUsed)
      const limit = n(f.limits.execution)
      if (fr.status === '0x0') {
        const oog = limit > 0 && used / limit >= 0.98
        findings.push({
          tone: 'fail',
          frame: i,
          title: oog ? `Frame ${i} ran out of gas` : `Frame ${i} reverted`,
          why: oog
            ? `It used ${fmt(used)} of its ${fmt(limit)} gas limit (${((used / limit) * 100).toFixed(1)}%), so it almost certainly hit the limit.`
            : `It stopped after ${fmt(used)} of ${fmt(limit)} gas, so it reverted on logic, not gas.`,
          fix: oog ? `Re-sign with frame ${i}'s gas limit raised to about ${fmt(roundUp(used * 1.25))}.` : 'Check the call below: the target contract rejected it.',
          selector: f.data.length >= 10 ? f.data.slice(0, 10) : undefined,
        })
      } else if (isVerify(f) && limit > SIDECAR_VERIFY_CAP && used < SIDECAR_VERIFY_CAP) {
        findings.push({
          tone: 'warn',
          frame: i,
          title: `Frame ${i} declares far more gas than it uses`,
          why: `It declares ${fmt(limit)} but used ${fmt(used)}. Declared limits count against the ${fmt(SIDECAR_VERIFY_CAP)} validation cap.`,
          fix: `Re-sign with a limit near ${fmt(roundUp(used * 1.25))} to stay under the cap.`,
        })
      }
    })
    if (receipt.status === '0x0') {
      const paid = (n(receipt.gasUsed) * price) / 1e18
      findings.push({
        tone: 'warn',
        title: 'Admitted, but it still failed, and the payer was charged',
        why: `Every admission rule passed, yet execution failed on chain. The payer paid ${paid.toFixed(6)} ETH for ${fmt(n(receipt.gasUsed))} gas.`,
        fix: 'Simulate the full transaction, not just validation, before sending.',
      })
    }
  }

  if (!findings.some((f) => f.tone === 'fail' || f.tone === 'warn')) {
    findings.push({ tone: 'pass', title: 'Nothing to fix', why: receipt ? 'Admitted and included, and every frame succeeded.' : 'Every admission rule passed.' })
  }

  const outcome = adm?.outcome ?? tx.entry?.status ?? 'unknown'
  const mempool: Verdict = !adm
    ? { tone: 'info', headline: 'Not seen', sub: 'This node has no admission record' }
    : outcome === 'rejected'
      ? { tone: 'fail', headline: 'Rejected', sub: fails.map((c) => c.rule).join(', ') || `error ${adm.errorCode}` }
      : outcome === 'included' || outcome === 'accepted'
        ? { tone: 'pass', headline: outcome === 'included' ? 'Admitted and included' : 'Admitted, pending', sub: `${(adm.checks ?? []).filter((c) => c.verdict === 'pass').length} checks passed` }
        : { tone: 'warn', headline: outcome[0].toUpperCase() + outcome.slice(1), sub: 'Left the mempool without being included' }

  const failedFrames = receipt?.frameReceipts.map((f, i) => (f.status === '0x0' ? i : -1)).filter((i) => i >= 0) ?? []
  const chain: Verdict = !receipt
    ? { tone: 'info', headline: 'Not on chain', sub: adm?.outcome === 'rejected' ? 'Never reached a block' : 'No receipt yet' }
    : receipt.status === '0x1'
      ? { tone: 'pass', headline: 'Executed', sub: `Block ${fmt(n(receipt.blockNumber))}, all ${receipt.frameReceipts.length} frames succeeded` }
      : { tone: 'fail', headline: 'Executed with a failure', sub: `Block ${fmt(n(receipt.blockNumber))}, frame ${failedFrames.join(', ')} failed` }

  const order: Record<Tone, number> = { fail: 0, warn: 1, info: 2, pass: 3 }
  findings.sort((a, b) => order[a.tone] - order[b.tone])
  return { frames, findings, mempool, chain, spec }
}
