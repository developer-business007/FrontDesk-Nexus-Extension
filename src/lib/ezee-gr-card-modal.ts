import { extractEzeeGroupReservationList } from './ezee-drawer-extract'
import { clearStaleReportFrames } from './ezee-reg-card-report'

const GR_CARD_MODAL_TITLE_RE = /print\s*gr\s*card\s*[-–]\s*options/i

function isVisibleGrCardModal(modal: HTMLElement): boolean {
  const wrap = modal.closest<HTMLElement>('.ant-modal-wrap')
  if (wrap) {
    if (wrap.style.display === 'none') return false
    if (wrap.classList.contains('ant-modal-hidden')) return false
    if (!wrap.classList.contains('ant-modal-open')) return false
  }
  if (!modal.classList.contains('ant-modal-open')) {
    const inWrap = modal.closest('.ant-modal-wrap.ant-modal-open')
    if (!inWrap) return false
  }
  const rect = modal.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function modalHasGrCardTitle(modal: HTMLElement): boolean {
  const title = modal.querySelector<HTMLElement>('.ant-modal-title, [class*="modal-title"]')
  const titleText = (title?.textContent ?? modal.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (GR_CARD_MODAL_TITLE_RE.test(titleText)) return true
  const sample = (modal.textContent ?? '').replace(/\s+/g, ' ').slice(0, 400)
  return GR_CARD_MODAL_TITLE_RE.test(sample) && /print\s*gr\s*card\s*for/i.test(sample)
}

export function findGrCardOptionsModal(doc: Document = document): HTMLElement | null {
  for (const modal of doc.querySelectorAll<HTMLElement>('.ant-modal, [role="dialog"]')) {
    if (!isVisibleGrCardModal(modal)) continue
    if (modalHasGrCardTitle(modal)) return modal
  }
  return null
}

export function waitForGrCardOptionsModal(timeoutMs = 1_500): Promise<HTMLElement | null> {
  const existing = findGrCardOptionsModal()
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve) => {
    let settled = false
    const finish = (modal: HTMLElement | null) => {
      if (settled) return
      settled = true
      obs.disconnect()
      window.clearTimeout(timer)
      resolve(modal)
    }

    const obs = new MutationObserver(() => {
      const modal = findGrCardOptionsModal()
      if (modal) finish(modal)
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })

    const timer = window.setTimeout(() => finish(null), timeoutMs)
  })
}

function isSelectedReservationsMode(modal: HTMLElement): boolean {
  for (const wrapper of modal.querySelectorAll<HTMLElement>('.ant-radio-wrapper, label')) {
    const text = (wrapper.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!/selected\s*reservations?/i.test(text)) continue
    const input = wrapper.querySelector<HTMLInputElement>('input[type="radio"]')
    if (input?.checked) return true
    if (wrapper.classList.contains('ant-radio-wrapper-checked')) return true
  }
  return false
}

function readGrCardDropdownLabel(modal: HTMLElement): string | null {
  const selected =
    modal.querySelector<HTMLElement>('.ant-select-selection-item') ??
    modal.querySelector<HTMLElement>('.ant-select-selector .ant-select-selection-item')
  const text = selected?.textContent?.replace(/\s+/g, ' ').trim()
  if (text) return text

  const active = modal.querySelector<HTMLElement>(
    '.ant-select-item-option-selected .ant-select-item-option-content, .ant-select-item-option-active .ant-select-item-option-content',
  )
  const activeText = active?.textContent?.replace(/\s+/g, ' ').trim()
  return activeText || null
}

function readGrCardDropdownOptions(modal: HTMLElement): string[] {
  const options = new Set<string>()
  for (const el of modal.querySelectorAll<HTMLElement>(
    '.ant-select-item-option-content, .ant-select-selection-item',
  )) {
    const text = el.textContent?.replace(/\s+/g, ' ').trim()
    if (text && /\d+\s*-\s*.+/i.test(text)) options.add(text)
  }
  const current = readGrCardDropdownLabel(modal)
  if (current) options.add(current)
  return [...options]
}

function leadingTokenFromGrLabel(label: string): string | null {
  const m = label.trim().match(/^([A-Z0-9][\w-]*)\s*[-–]\s*/i)
  return m?.[1]?.trim() ?? null
}

/** Map GR card dropdown row to sub-reservation # when group list is on the page. */
export function resolveGrCardConfirmation(modal: HTMLElement, fallbackConf: string): string {
  const label = readGrCardDropdownLabel(modal)
  const useDropdown = isSelectedReservationsMode(modal) || !!label

  if (useDropdown && label) {
    const members = extractEzeeGroupReservationList(document)
    if (members.length > 1) {
      const options = readGrCardDropdownOptions(modal)
      const idx = options.findIndex((o) => o === label)
      if (idx < 0) {
        const token = leadingTokenFromGrLabel(label)
        const byToken = options.findIndex((o) => o.startsWith(`${token} `) || o.startsWith(`${token}-`))
        if (byToken >= 0 && members[byToken]) return members[byToken].confirmationNumber
      } else if (members[idx]) {
        return members[idx].confirmationNumber
      }
    }

    const token = leadingTokenFromGrLabel(label)
    if (token) return token
  }

  return fallbackConf.trim()
}

export function isGrCardModalPrintButton(modal: HTMLElement, target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const btn = target.closest<HTMLElement>('button, .ant-btn, [role="button"]')
  if (!btn || !modal.contains(btn)) return false
  const label = btn.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  return /^print$/i.test(label)
}

let grCardModalPrintListenerInstalled = false

/**
 * Group check-in: permanent capture listener for Print in "Print GR Card - Options".
 * Survives modal close/reopen — no cleanup between prints.
 */
export function installGrCardModalPrintListener(
  getFallbackConf: () => string,
  onPrint: (confirmation: string) => void,
): void {
  if (grCardModalPrintListenerInstalled) return
  grCardModalPrintListenerInstalled = true

  document.addEventListener(
    'click',
    (event) => {
      const modal = findGrCardOptionsModal()
      if (!modal) return
      if (!isGrCardModalPrintButton(modal, event.target)) return

      clearStaleReportFrames()
      const conf = resolveGrCardConfirmation(modal, getFallbackConf())
      console.info('[FDN eZee] Group GR card modal Print | confirmation:', conf)
      onPrint(conf)
    },
    true,
  )
}