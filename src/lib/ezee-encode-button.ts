/**
 * Inject "Encode key" next to eZee Guest Info Edit / More / Print.
 * Content-script only — does not depend on the side panel being open.
 */

const BTN_ID = 'fdn-ezee-encode-key-btn'
const STATUS_ID = 'fdn-ezee-encode-status'
const STYLE_ID = 'fdn-ezee-encode-styles'
const WRAP_ID = 'fdn-ezee-encode-wrap'

const ACTION_LABELS = new Set(['edit', 'more', 'print'])

export type EzeeEncodeClickHandler = () => void | Promise<void>

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
#${WRAP_ID} {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
  vertical-align: middle;
  flex-wrap: wrap;
}
#${BTN_ID} {
  appearance: none;
  border: 1px solid #1a7f37;
  background: #238636;
  color: #fff;
  font: 600 12px/1.2 system-ui, Segoe UI, sans-serif;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(0,0,0,.12);
}
#${BTN_ID}:hover:not(:disabled) {
  background: #2ea043;
}
#${BTN_ID}:disabled {
  opacity: 0.65;
  cursor: wait;
}
#${STATUS_ID} {
  font: 600 11px/1.3 system-ui, Segoe UI, sans-serif;
  max-width: 220px;
}
#${STATUS_ID}[data-variant="ok"] { color: #1a7f37; }
#${STATUS_ID}[data-variant="err"] { color: #cf222e; }
#${STATUS_ID}[data-variant="busy"] { color: #57606a; }
.fdn-ezee-encode-fallback {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px;
  padding: 8px 10px;
  border: 1px solid #1a7f37;
  border-radius: 8px;
  background: #f0fff4;
}
`
  document.documentElement.appendChild(style)
}

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function isActionControl(el: Element): boolean {
  const t = normalizeLabel(el.textContent ?? '')
  const matched =
    ACTION_LABELS.has(t) ||
    ACTION_LABELS.has(t.split(/\s+/).filter(Boolean)[0] ?? '')
  if (!matched) return false
  // Avoid huge containers that happen to start with "Edit"
  if (t.length > 24) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'button' || tag === 'a') return true
  if (el.getAttribute('role') === 'button') return true
  if (el.classList.contains('ant-btn')) return true
  // Prefer the button host over nested label spans
  const host = el.closest('button, a, [role="button"], .ant-btn')
  if (host && host !== el) return false
  return false
}

/** Find Edit / More / Print controls inside a guest panel. */
function findActionControls(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  const candidates = root.querySelectorAll<HTMLElement>(
    'button, a, [role="button"], .ant-btn, span, div',
  )
  for (const el of candidates) {
    if (!isActionControl(el)) continue
    const host =
      (el.closest('button, a, [role="button"], .ant-btn') as HTMLElement | null) ?? el
    if (!out.includes(host)) out.push(host)
  }
  return out
}

function pickToolbarParent(actions: HTMLElement[]): HTMLElement | null {
  if (actions.length === 0) return null
  // Prefer a parent that contains ≥2 of Edit/More/Print
  let best: HTMLElement | null = null
  let bestScore = 0
  for (const a of actions) {
    let node: HTMLElement | null = a.parentElement
    for (let depth = 0; depth < 6 && node; depth++) {
      const labels = new Set(
        findActionControls(node).map((el) => normalizeLabel(el.textContent ?? '')),
      )
      let score = 0
      for (const l of ACTION_LABELS) if (labels.has(l)) score++
      if (score > bestScore) {
        bestScore = score
        best = node
      }
      if (score >= 2) return node
      node = node.parentElement
    }
  }
  return bestScore > 0 ? best : actions[0]!.parentElement
}

function setStatus(text: string, variant: 'ok' | 'err' | 'busy'): void {
  const el = document.getElementById(STATUS_ID)
  if (!el) return
  el.textContent = text
  el.setAttribute('data-variant', variant)
}

export function setEzeeEncodeButtonBusy(busy: boolean, label?: string): void {
  const btn = document.getElementById(BTN_ID) as HTMLButtonElement | null
  if (!btn) return
  btn.disabled = busy
  btn.textContent = label ?? (busy ? 'Encoding…' : 'Encode key')
  if (busy) setStatus('Place card on encoder…', 'busy')
}

export function setEzeeEncodeButtonResult(ok: boolean, message: string): void {
  setEzeeEncodeButtonBusy(false)
  setStatus(message, ok ? 'ok' : 'err')
}

function buildButton(onEncode: EzeeEncodeClickHandler): HTMLElement {
  const wrap = document.createElement('span')
  wrap.id = WRAP_ID

  const btn = document.createElement('button')
  btn.id = BTN_ID
  btn.type = 'button'
  btn.textContent = 'Encode key'
  btn.title = 'Encode RFID key for this guest (FrontDesk Nexus)'
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    void onEncode()
  })

  const status = document.createElement('span')
  status.id = STATUS_ID
  status.setAttribute('data-variant', 'busy')

  wrap.append(btn, status)
  return wrap
}

function removeStaleMounts(keepRoot: HTMLElement | null): void {
  for (const el of document.querySelectorAll(`#${WRAP_ID}`)) {
    if (keepRoot && keepRoot.contains(el)) continue
    el.remove()
  }
}

/**
 * Ensure the Encode key control exists in the open guest drawer / detail panel.
 * Safe to call often (MutationObserver); no-ops when already mounted.
 */
export function syncEzeeEncodeButton(
  panelRoot: HTMLElement | null,
  onEncode: EzeeEncodeClickHandler,
): void {
  ensureStyles()
  if (!panelRoot) {
    removeStaleMounts(null)
    return
  }

  const existing = panelRoot.querySelector(`#${WRAP_ID}`)
  if (existing) return

  removeStaleMounts(panelRoot)

  const actions = findActionControls(panelRoot)
  const toolbar = pickToolbarParent(actions)
  const wrap = buildButton(onEncode)

  if (toolbar) {
    toolbar.appendChild(wrap)
    return
  }

  // Fallback: strip under drawer/detail header
  wrap.classList.add('fdn-ezee-encode-fallback')
  const body =
    panelRoot.querySelector<HTMLElement>('.ant-drawer-body, .ant-drawer-wrapper-body') ??
    panelRoot
  body.insertBefore(wrap, body.firstChild)
}
