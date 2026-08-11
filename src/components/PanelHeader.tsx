import { useEffect, useRef, useState } from 'react'
import { ExtensionLogo } from './ExtensionLogo'

type Props = {
  signedIn: boolean
  email: string | null
  role: string | null
  displayName: string
  roleLabel: string
  idScanner: 'connected' | 'disconnected'
  idScannerSources: string[]
  thalesConnected: boolean
  selectedScanner: 'thales' | 'twain'
  rfidEncoder: 'connected' | 'disconnected'
  idCheckedAgo: string
  keyCheckedAgo: string
  rfidCheckBusy: boolean
  hotelPolicyBusy?: boolean
  onOpenHotelPolicy?: () => void
  onLogout: () => void
  onRefreshId: () => void
  onCheckKey: () => void
  onSelectScanner: (scanner: 'thales' | 'twain') => void
}

function PolicyDocIcon() {
  return (
    <svg
      className="fdn-header__policy-icon"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  )
}

function LogOutIcon() {
  return (
    <svg
      className="fdn-header__logout-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export function PanelHeader({
  signedIn,
  email,
  role,
  displayName,
  roleLabel,
  idScanner,
  idScannerSources,
  thalesConnected,
  selectedScanner,
  rfidEncoder,
  idCheckedAgo,
  keyCheckedAgo,
  rfidCheckBusy,
  hotelPolicyBusy = false,
  onOpenHotelPolicy,
  onLogout,
  onRefreshId,
  onCheckKey,
  onSelectScanner,
}: Props) {
  const idOn = idScanner === 'connected'
  const keyOn = rfidEncoder === 'connected'

  const [idMenuOpen, setIdMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!idMenuOpen) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIdMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [idMenuOpen])

  function handleIdPillClick() {
    if (!idMenuOpen) onRefreshId()
    setIdMenuOpen(o => !o)
  }

  function handleSelectScanner(s: 'thales' | 'twain') {
    onSelectScanner(s)
    setIdMenuOpen(false)
  }

  const ambirSource = idScannerSources[0] ?? 'Ambir DS690gt'
  const ambirOn = idScannerSources.length > 0

  const pillLabel = selectedScanner === 'thales' ? 'QS2000' : ambirSource.split(/\s+/).pop() ?? 'Ambir'

  return (
    <header className="fdn-header fdn-header--compact">
      <div className="fdn-header__row fdn-header__row--main">
        <ExtensionLogo compact />
        <div className="fdn-header__meta">
          {signedIn ? (
            <span className="fdn-header__user" title={email ?? undefined}>
              <span className="fdn-header__name">{displayName}</span>
              <span className="fdn-header__sep">·</span>
              <span
                className={[
                  'fdn-header__role',
                  role?.toLowerCase() === 'admin' ? 'fdn-header__role--admin' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {roleLabel}
              </span>
            </span>
          ) : (
            <span className="fdn-header__user fdn-header__user--muted">Not signed in</span>
          )}
        </div>
        <div className="fdn-header__toolbar">
          {signedIn && onOpenHotelPolicy ? (
            <button
              type="button"
              className="fdn-hw-pill fdn-hw-pill--policy"
              disabled={hotelPolicyBusy}
              title="Open hotel policy on guest display"
              onClick={onOpenHotelPolicy}
            >
              <PolicyDocIcon />
              <span className="fdn-hw-pill__label">{hotelPolicyBusy ? '…' : 'Policy'}</span>
            </button>
          ) : null}
          <div className="fdn-header__actions" role="group" aria-label="Hardware status">

            {/* ── ID scanner pill + dropdown ───────────────────────────── */}
            <div className="fdn-hw-pill-wrap" ref={wrapRef}>
              <button
                type="button"
                className={`fdn-hw-pill ${idOn ? 'fdn-hw-pill--ok' : 'fdn-hw-pill--bad'} ${idMenuOpen ? 'fdn-hw-pill--active' : ''}`}
                title={`ID scanner (${pillLabel}) · click to switch or refresh`}
                onClick={handleIdPillClick}
              >
                <span className={`fdn-hw-pill__dot ${idOn ? 'fdn-hw-pill__dot--ok' : 'fdn-hw-pill__dot--bad'}`} />
                <span className="fdn-hw-pill__label">ID</span>
                <span className="fdn-hw-pill__state">{idOn ? pillLabel : 'off'}</span>
                <span className="fdn-hw-pill__time">{idCheckedAgo}</span>
              </button>

              {idMenuOpen && (
                <div className="fdn-hw-dropdown">
                  <div className="fdn-hw-dropdown__heading">ID Scanner</div>

                  {/* Thales QS2000 row */}
                  <button
                    type="button"
                    className={`fdn-hw-dropdown__row fdn-hw-dropdown__row--btn ${selectedScanner === 'thales' ? 'fdn-hw-dropdown__row--selected' : ''}`}
                    onClick={() => handleSelectScanner('thales')}
                  >
                    <span className="fdn-hw-dropdown__check">{selectedScanner === 'thales' ? '✓' : ''}</span>
                    <span className={`fdn-hw-pill__dot ${thalesConnected ? 'fdn-hw-pill__dot--ok' : 'fdn-hw-pill__dot--bad'}`} />
                    <span className="fdn-hw-dropdown__name">Thales QS2000</span>
                    <span className={`fdn-hw-dropdown__state ${thalesConnected ? 'fdn-hw-dropdown__state--ok' : 'fdn-hw-dropdown__state--bad'}`}>
                      {thalesConnected ? 'on' : 'off'}
                    </span>
                  </button>

                  {/* AMBIR row */}
                  <button
                    type="button"
                    className={`fdn-hw-dropdown__row fdn-hw-dropdown__row--btn ${selectedScanner === 'twain' ? 'fdn-hw-dropdown__row--selected' : ''}`}
                    onClick={() => handleSelectScanner('twain')}
                  >
                    <span className="fdn-hw-dropdown__check">{selectedScanner === 'twain' ? '✓' : ''}</span>
                    <span className={`fdn-hw-pill__dot ${ambirOn ? 'fdn-hw-pill__dot--ok' : 'fdn-hw-pill__dot--bad'}`} />
                    <span className="fdn-hw-dropdown__name">{ambirSource}</span>
                    <span className={`fdn-hw-dropdown__state ${ambirOn ? 'fdn-hw-dropdown__state--ok' : 'fdn-hw-dropdown__state--bad'}`}>
                      {ambirOn ? 'on' : 'off'}
                    </span>
                  </button>

                </div>
              )}
            </div>

            <button
              type="button"
              className={`fdn-hw-pill ${keyOn ? 'fdn-hw-pill--ok' : 'fdn-hw-pill--bad'}`}
              title={`Key encoder — ${keyOn ? 'connected' : 'offline'} · ${keyCheckedAgo}`}
              disabled={rfidCheckBusy}
              onClick={onCheckKey}
            >
              <span className={`fdn-hw-pill__dot ${keyOn ? 'fdn-hw-pill__dot--ok' : 'fdn-hw-pill__dot--bad'}`} />
              <span className="fdn-hw-pill__label">Key</span>
              <span className="fdn-hw-pill__state">{rfidCheckBusy ? '…' : keyOn ? 'on' : 'off'}</span>
              <span className="fdn-hw-pill__time">{rfidCheckBusy ? 'chk' : keyCheckedAgo}</span>
            </button>
            {signedIn ? (
              <button
                type="button"
                className="fdn-header__logout"
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOutIcon />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}