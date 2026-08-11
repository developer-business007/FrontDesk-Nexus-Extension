const REPORT_URL_RE = /stimulsoft|invoicejson\.php/i
const REG_CARD_VIEWER_TITLE_RE = /print\s*guest\s*registration\s*card/i
const GR_CARD_OPTIONS_TITLE_RE = /print\s*gr\s*card\s*[-–]\s*options/i

function isVisibleRect(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 80 && rect.height > 80
}

function isVisibleAntWrap(wrap: HTMLElement): boolean {
  if (wrap.style.display === 'none') return false
  if (wrap.classList.contains('ant-modal-hidden')) return false
  if (!wrap.classList.contains('ant-modal-open')) return false
  return isVisibleRect(wrap)
}

function isVisibleAntDrawer(drawer: HTMLElement): boolean {
  if (drawer.style.display === 'none') return false
  if (drawer.getAttribute('aria-hidden') === 'true') return false
  const content = drawer.querySelector<HTMLElement>('.ant-drawer-content-wrapper') ?? drawer
  return isVisibleRect(content)
}

function titleFromContainer(root: HTMLElement): string {
  for (const sel of [
    '.ant-drawer-title',
    '.ant-modal-title',
    '[class*="drawer-title"]',
    '[class*="modal-title"]',
  ]) {
    const el = root.querySelector<HTMLElement>(sel)
    const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  return ''
}

function isRegCardViewerTitle(title: string): boolean {
  if (!title) return false
  if (!REG_CARD_VIEWER_TITLE_RE.test(title)) return false
  if (GR_CARD_OPTIONS_TITLE_RE.test(title)) return false
  return true
}

/**
 * Visible container for the PDF viewer — eZee uses an Ant **drawer** (not modal)
 * titled "Print Guest Registration Card" with iframe#reportFrame inside.
 */
export function getRegCardViewerRoot(doc: Document = document): HTMLElement | null {
  for (const drawer of doc.querySelectorAll<HTMLElement>('.ant-drawer')) {
    if (!isVisibleAntDrawer(drawer)) continue
    const title = titleFromContainer(drawer)
    if (isRegCardViewerTitle(title)) return drawer
  }

  for (const wrap of doc.querySelectorAll<HTMLElement>('.ant-modal-wrap')) {
    if (!isVisibleAntWrap(wrap)) continue
    const title = titleFromContainer(wrap)
    if (isRegCardViewerTitle(title)) return wrap
  }

  // Fallback: visible #reportFrame inside any open drawer with matching title nearby
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>(
    'iframe#reportFrame, iframe[name="reportFrame"]',
  )) {
    if (!isVisibleRect(frame)) continue
    const drawer = frame.closest<HTMLElement>('.ant-drawer')
    if (!drawer || !isVisibleAntDrawer(drawer)) continue
    const title = titleFromContainer(drawer)
    if (isRegCardViewerTitle(title)) return drawer
  }

  return null
}

/** @deprecated use getRegCardViewerRoot */
export function findRegCardViewerModal(doc: Document = document): HTMLElement | null {
  const root = getRegCardViewerRoot(doc)
  if (!root) return null
  return root.querySelector<HTMLElement>('.ant-modal, .ant-drawer-content') ?? root
}

export function isReportUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed || trimmed === 'about:blank') return false
  if (REPORT_URL_RE.test(trimmed)) return true
  try {
    const abs = new URL(trimmed, location.href)
    const blob = `${abs.pathname}${abs.search}`
    if (/report|stimulsoft|viewer|invoicejson/i.test(blob)) return true
  } catch {
    /* ignore */
  }
  return false
}

function normalizeReportUrl(url: string): string {
  try {
    const abs = new URL(url, location.href)
    abs.searchParams.delete('_fdn')
    return abs.href
  } catch {
    return url.split('&_fdn=')[0] ?? url
  }
}

/** Stimulsoft POST form inside iframe#reportFrame (same-origin). */
function readReportFormAction(frame: HTMLIFrameElement): string | null {
  try {
    const doc = frame.contentDocument ?? frame.contentWindow?.document ?? null
    if (!doc) return null
    const form =
      doc.querySelector<HTMLFormElement>('#reportForm') ??
      doc.querySelector<HTMLFormElement>('form[action*="stimulsoft"]') ??
      doc.querySelector<HTMLFormElement>('form[action*="invoicejson"]')
    const action = form?.getAttribute('action') ?? form?.action ?? ''
    if (action && isReportUrl(action)) {
      return new URL(action, frame.contentWindow?.location.href ?? location.href).href
    }
  } catch {
    /* cross-origin */
  }
  return null
}

function readRawIframeUrl(frame: HTMLIFrameElement): string | null {
  const formAction = readReportFormAction(frame)
  if (formAction) return formAction

  try {
    const href = frame.contentWindow?.location?.href ?? ''
    if (href && href !== 'about:blank') return href
  } catch {
    /* cross-origin */
  }

  const src = frame.getAttribute('src') ?? frame.src ?? ''
  if (src && src !== 'about:blank') return src
  return null
}

function readIframeReportUrl(frame: HTMLIFrameElement): string | null {
  const raw = readRawIframeUrl(frame)
  return raw && isReportUrl(raw) ? raw : null
}

function readIframesIn(root: HTMLElement): string | null {
  for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
    const url = readIframeReportUrl(frame)
    if (url) return url
  }
  return null
}

function readGlobalReportFrame(doc: Document = document): string | null {
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>(
    'iframe#reportFrame, iframe[name="reportFrame"]',
  )) {
    const url = readIframeReportUrl(frame)
    if (url) return url
  }
  return null
}

/** Read Stimulsoft report URL from the viewer drawer/modal. */
export function readRegCardViewerReportUrl(modal: HTMLElement): string | null {
  return readIframesIn(modal)
}

export type RegCardReportHit = { url: string; source: string }

export function readAnyRegCardReportUrl(doc: Document = document): RegCardReportHit | null {
  const root = getRegCardViewerRoot(doc)
  if (root) {
    const url = readIframesIn(root)
    if (url) return { url, source: 'viewer-drawer' }
  }

  const frameUrl = readGlobalReportFrame(doc)
  if (frameUrl) return { url: frameUrl, source: 'reportFrame' }

  return null
}

/** Blank hidden report iframe so eZee loads a fresh Stimulsoft URL on the next Print. */
export function clearStaleReportFrames(doc: Document = document): void {
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>(
    'iframe#reportFrame, iframe[name="reportFrame"]',
  )) {
    const src = frame.getAttribute('src') ?? ''
    if (!src || src === 'about:blank') continue
    try {
      frame.src = 'about:blank'
    } catch {
      /* ignore */
    }
  }
}

/** Baseline uses src only — contentWindow can lag after src is cleared. */
function collectBaselineReportUrls(doc: Document = document): Set<string> {
  const urls = new Set<string>()
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>(
    'iframe#reportFrame, iframe[name="reportFrame"]',
  )) {
    const src = frame.getAttribute('src') ?? ''
    if (src && src !== 'about:blank' && isReportUrl(src)) {
      urls.add(normalizeReportUrl(src))
    }
  }
  return urls
}

export function cacheBustReportUrl(url: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}_fdn=${Date.now()}`
}

let regCardArmSeq = 0

/**
 * Arm after user clicks Print (group options) or Print Guest Registration Card menu.
 * Waits for eZee's viewer drawer and iframe#reportFrame Stimulsoft URL.
 */
export function armRegCardViewerWatch(
  confirmation: string,
  onReportReady: (reportUrl: string, confirmation: string) => void,
  timeoutMs = 45_000,
): void {
  const conf = confirmation.trim()
  if (!conf) return

  const armId = ++regCardArmSeq
  const armedAt = Date.now()
  const viewerOpenAtArm = !!getRegCardViewerRoot()
  const baselineUrls = collectBaselineReportUrls()
  let sawIframeActivityAfterArm = false

  console.info('[FDN eZee] Armed reg card viewer watch', {
    confirmation: conf,
    armId,
    viewerOpenAtArm,
    baselineCount: baselineUrls.size,
  })

  let settled = false
  const attachedFrames = new WeakSet<HTMLIFrameElement>()

  const finish = (url: string | null, reason: string) => {
    if (settled || armId !== regCardArmSeq) return
    settled = true
    cleanup()
    if (!url) {
      console.warn('[FDN eZee] Reg card viewer watch timed out', {
        confirmation: conf,
        armId,
        lastReason: reason,
      })
      return
    }
    console.info('[FDN eZee] Reg card viewer report URL captured', {
      source: reason,
      url: url.slice(0, 120),
      confirmation: conf,
    })
    onReportReady(cacheBustReportUrl(url), conf)
  }

  const tryAccept = (reason: string): boolean => {
    if (armId !== regCardArmSeq || settled) return false

    const viewerRoot = getRegCardViewerRoot()
    const hit = readAnyRegCardReportUrl()
    if (!hit || !isReportUrl(hit.url)) return false

    const normalized = normalizeReportUrl(hit.url)
    const viewerJustOpened = !viewerOpenAtArm && !!viewerRoot
    const isFreshUrl = !baselineUrls.has(normalized)

    if (!viewerRoot && hit.source !== 'reportFrame') return false

    if (!isFreshUrl && !sawIframeActivityAfterArm && !viewerJustOpened) {
      return false
    }

    console.info('[FDN eZee] Reg card viewer ready:', reason, hit.source)
    finish(hit.url, hit.source)
    return true
  }

  const noteIframeActivity = (frame: HTMLIFrameElement) => {
    const viewerRoot = getRegCardViewerRoot()
    const inViewer = viewerRoot?.contains(frame) ?? false
    const isReportFrame =
      frame.id === 'reportFrame' ||
      frame.name === 'reportFrame' ||
      frame.matches('iframe#reportFrame, iframe[name="reportFrame"]')
    if (inViewer || isReportFrame) {
      sawIframeActivityAfterArm = true
    }
  }

  const attachFrameLoad = (frame: HTMLIFrameElement) => {
    if (attachedFrames.has(frame)) return
    attachedFrames.add(frame)
    frame.addEventListener('load', () => {
      if (armId !== regCardArmSeq || settled) return
      noteIframeActivity(frame)
      window.setTimeout(() => tryAccept('iframe-load'), 600)
    })
  }

  const scanFrames = () => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      'iframe#reportFrame, iframe[name="reportFrame"]',
    )) {
      attachFrameLoad(frame)
    }
    const root = getRegCardViewerRoot()
    if (root) {
      for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
        attachFrameLoad(frame)
      }
    }
  }

  const cleanup = () => {
    obs.disconnect()
    window.clearInterval(pollTimer)
    window.clearTimeout(timer)
  }

  scanFrames()

  const obs = new MutationObserver(() => {
    scanFrames()
    tryAccept('mutation')
  })
  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'class', 'style', 'action'],
  })

  const pollTimer = window.setInterval(() => {
    if (Date.now() - armedAt < 250) return
    scanFrames()
    tryAccept('poll')
  }, 200)

  const timer = window.setTimeout(() => finish(null, 'timeout'), timeoutMs)
}
