import type { Finding } from '../diagnose'
import { EXPLORER } from '../rpc'

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`

/** The fix for an out-of-gas frame, one Fix & send button, and the old ❌ / new ✅ comparison once it has run. */
export function FixAndSend(p: { finding: Finding; oldHash: string | null; newHash: string | null; busy: boolean; onFix: () => void }) {
  return (
    <div className="fixsend">
      <p className="f-title">{p.finding.title}</p>
      {p.finding.fix && <p className="fix">{p.finding.fix}</p>}
      {p.finding.patch?.kind === 'gas' && (
        <p className="how">
          New limit {p.finding.patch.gas.toLocaleString('en-US')}: the gas this frame used in the dry run or on chain, plus 25% headroom, rounded up to the
          next 1,000. Fix & send checks it with a fresh dry run before sending.
        </p>
      )}
      {!p.newHash && (
        <button type="button" className="primary" onClick={p.onFix} disabled={p.busy}>
          {p.busy ? 'Fixing' : 'Fix & send'}
        </button>
      )}
      <ul className="compare" aria-label="Before and after">
        <li className="fail">
          <span aria-hidden="true">❌</span>{' '}
          {p.oldHash ? (
            <a href={EXPLORER(p.oldHash, 'miner')} target="_blank" rel="noreferrer">
              <code>{short(p.oldHash)}</code>
            </a>
          ) : (
            <span>Caught by the dry run, never sent</span>
          )}
        </li>
        {p.newHash && (
          <li className="pass">
            <span aria-hidden="true">✅</span>{' '}
            <a href={EXPLORER(p.newHash, 'miner')} target="_blank" rel="noreferrer">
              <code>{short(p.newHash)}</code>
            </a>
          </li>
        )}
      </ul>
    </div>
  )
}
