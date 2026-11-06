'use client'
// T50: point Readmit at your own ethrex RPC and mempool sidecars. Saved in this browser only; applied on reload.
import { useState, useSyncExternalStore } from 'react'
import { DEFAULT_ENDPOINTS, ENDPOINTS, saveEndpoints, type Endpoints as EP } from '../rpc'

const FIELDS: { key: keyof EP; label: string }[] = [
  { key: 'ethrex', label: 'ethrex RPC (reads, dry runs)' },
  { key: 'gateway', label: 'Gateway sidecar' },
  { key: 'miner', label: 'Miner sidecar (sends)' },
]

const noop = () => () => {}

export function Endpoints() {
  // The form fills when opened, and "custom" is false on the server, so the static HTML and the first client render match.
  const [form, setForm] = useState<EP | null>(null)
  const custom = useSyncExternalStore(noop, () => FIELDS.some((f) => ENDPOINTS[f.key] !== DEFAULT_ENDPOINTS[f.key]), () => false)
  const valid = form != null && FIELDS.every((f) => /^https?:\/\/\S+$/.test(form[f.key]))
  return (
    <details className="endpoints" onToggle={(e) => e.currentTarget.open && !form && setForm({ ...ENDPOINTS })}>
      <summary>
        Endpoints{custom ? ' (custom)' : ''}: use your own node
      </summary>
      {form && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            saveEndpoints(form)
            location.reload()
          }}
        >
          <p className="muted">Readmit talks to these URLs straight from your browser, plus the Sourcify signature lookup (api.4byte.sourcify.dev) to name function selectors. The URLs are saved in this browser only.</p>
          {FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <input type="url" value={form[f.key]} spellCheck={false} onChange={(e) => setForm({ ...form, [f.key]: e.target.value.trim() })} />
            </label>
          ))}
          <div className="row">
            <button type="submit" className="primary" disabled={!valid}>
              Save and reload
            </button>
            <button
              type="button"
              onClick={() => {
                saveEndpoints({})
                location.reload()
              }}
            >
              Reset to defaults
            </button>
          </div>
        </form>
      )}
    </details>
  )
}
