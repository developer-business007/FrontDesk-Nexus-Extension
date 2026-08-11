import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// Signature overlay position for Synxis PDF (points, origin = bottom-left)
const SIG_X = 140
const SIG_Y = 310
const SIG_W = 200
const SIG_H = 40

const REG_CARD_SIGNING_KEY = 'fdn_reg_card_signing_active'
const SIGNATURE_AUTO_SAVE_MS = 10_000

type RegCardData =
  | { pdfBase64: string; confirmation: string }
  | { ezeeReportUrl: string; confirmation: string }

let currentPdfBytes: Uint8Array | null = null
let currentPdfUrl: string | null = null
let isEzeeMode = false
let signatureSaveInFlight = false

async function setRegCardSigningActive(active: boolean): Promise<void> {
  if (active) {
    await chrome.storage.local.set({ [REG_CARD_SIGNING_KEY]: true })
  } else {
    await chrome.storage.local.remove(REG_CARD_SIGNING_KEY)
  }
}

async function notifySignatureComplete(): Promise<void> {
  await setRegCardSigningActive(false)
  try {
    await chrome.runtime.sendMessage({ type: 'REG_CARD_SIGNATURE_COMPLETE' })
  } catch {
    /* side panel may be closed */
  }
}

async function init() {
  await setRegCardSigningActive(true)
  window.addEventListener('beforeunload', () => {
    void setRegCardSigningActive(false)
  })

  const result = await chrome.storage.local.get('regCardData') as { regCardData?: RegCardData }
  const data = result.regCardData
  if (!data) {
    document.body.innerHTML = '<p style="padding:2rem;color:red;font-family:sans-serif">No registration card data found. Please close this window and try again.</p>'
    await setRegCardSigningActive(false)
    return
  }

  document.getElementById('confLabel')!.textContent = data.confirmation

  if ('ezeeReportUrl' in data) {
    isEzeeMode = true
    ;(document.getElementById('pdfEmbed') as HTMLIFrameElement).src = data.ezeeReportUrl
    setupSignatureCanvas()
    await moveToSecondScreen()
    // Delay so the iframe has time to load before the modal appears
    window.setTimeout(() => {
      document.getElementById('signModal')!.classList.add('open')
    }, 2000)
    return
  }

  isEzeeMode = false
  const raw = data.pdfBase64.includes(',') ? data.pdfBase64.split(',')[1]! : data.pdfBase64
  const binary = atob(raw)
  currentPdfBytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) currentPdfBytes[i] = binary.charCodeAt(i)

  showPdf(currentPdfBytes)
  setupSignatureCanvas()
  await moveToSecondScreen()
  document.getElementById('signModal')!.classList.add('open')
}

function showPdf(bytes: Uint8Array) {
  if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl)
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  currentPdfUrl = URL.createObjectURL(blob)
  ;(document.getElementById('pdfEmbed') as HTMLIFrameElement).src = currentPdfUrl + '#zoom=140'
}

async function moveToSecondScreen() {
  try {
    const displays = await chrome.system.display.getInfo()
    const second = displays.find(d => !d.isPrimary) ?? displays[1]
    if (!second) return

    const win = await chrome.windows.getCurrent()
    if (win.id === undefined) return

    await chrome.windows.update(win.id, {
      left: second.workArea.left,
      top: second.workArea.top,
      width: second.workArea.width,
      height: second.workArea.height,
      state: 'normal',
      focused: true,
    })
    window.focus()
  } catch (e) {
    console.error('[FDN RegCard] Display detection failed:', e)
  }
}

function canvasHasInk(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): boolean {
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 0) return true
  }
  return false
}

function setupSignatureCanvas() {
  const canvas = document.getElementById('sigCanvas') as HTMLCanvasElement
  const modal = document.getElementById('signModal') as HTMLDivElement
  const status = document.getElementById('sigStatus') as HTMLParagraphElement
  const ctx = canvas.getContext('2d')!

  ctx.strokeStyle = '#1a237e'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  let drawing = false
  let autoSaveTimer = 0

  function getPos(e: PointerEvent) {
    const r = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    }
  }

  function clearAutoSaveTimer() {
    window.clearTimeout(autoSaveTimer)
    autoSaveTimer = 0
  }

  function scheduleAutoSave() {
    clearAutoSaveTimer()
    if (!modal.classList.contains('open') || signatureSaveInFlight) return
    autoSaveTimer = window.setTimeout(() => {
      if (!modal.classList.contains('open') || signatureSaveInFlight) return
      if (!canvasHasInk(ctx, canvas)) return
      status.textContent = 'Auto-saving signature…'
      void embedSignature(canvas, modal, status, { auto: true })
    }, SIGNATURE_AUTO_SAVE_MS)
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault()
    clearAutoSaveTimer()
    canvas.setPointerCapture(e.pointerId)
    drawing = true
    ctx.beginPath()
    const p = getPos(e)
    ctx.moveTo(p.x, p.y)
  })
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return
    const p = getPos(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  })
  const onStrokeEnd = () => {
    drawing = false
    scheduleAutoSave()
  }
  canvas.addEventListener('pointerup', onStrokeEnd)
  canvas.addEventListener('pointercancel', onStrokeEnd)
  canvas.addEventListener('pointerleave', onStrokeEnd)

  document.getElementById('btnClear')!.onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    clearAutoSaveTimer()
    status.textContent = ''
  }
  document.getElementById('btnCancel')!.onclick = () => {
    clearAutoSaveTimer()
    modal.classList.remove('open')
  }
  document.getElementById('btnSave')!.onclick = () => {
    clearAutoSaveTimer()
    void embedSignature(canvas, modal, status, { auto: false })
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function embedSignature(
  canvas: HTMLCanvasElement,
  modal: HTMLElement,
  status: HTMLElement,
  opts: { auto: boolean },
) {
  if (signatureSaveInFlight) return
  signatureSaveInFlight = true

  const btn = document.getElementById('btnSave') as HTMLButtonElement
  btn.disabled = true
  btn.textContent = 'Saving…'

  try {
    const pngDataUrl = canvas.toDataURL('image/png')
    let savedBytes: Uint8Array

    if (isEzeeMode) {
      const pdfDoc = await PDFDocument.create()
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
      const page = pdfDoc.addPage([612, 792])
      const { height } = page.getSize()
      const conf = document.getElementById('confLabel')?.textContent?.trim() ?? ''

      page.drawText('Guest Registration Card — Signature Record', {
        x: 50, y: height - 60, size: 14, font: bold, color: rgb(0.08, 0.28, 0.56),
      })
      page.drawText(`Confirmation: ${conf}`, {
        x: 50, y: height - 86, size: 11, font, color: rgb(0.2, 0.2, 0.2),
      })
      page.drawText(`Signed: ${new Date().toLocaleString()}`, {
        x: 50, y: height - 106, size: 10, font, color: rgb(0.45, 0.45, 0.45),
      })
      page.drawLine({
        start: { x: 50, y: height - 124 }, end: { x: 562, y: height - 124 },
        thickness: 0.5, color: rgb(0.75, 0.75, 0.75),
      })
      page.drawText('Guest Signature:', {
        x: 50, y: height - 152, size: 11, font, color: rgb(0.2, 0.2, 0.2),
      })
      const pngImage = await pdfDoc.embedPng(pngDataUrl)
      page.drawImage(pngImage, { x: 50, y: height - 270, width: 350, height: 90 })
      page.drawLine({
        start: { x: 50, y: height - 276 }, end: { x: 400, y: height - 276 },
        thickness: 0.5, color: rgb(0.3, 0.3, 0.3),
      })

      savedBytes = await pdfDoc.save()
    } else {
      if (!currentPdfBytes) return
      const pdfDoc = await PDFDocument.load(currentPdfBytes)
      const pngImage = await pdfDoc.embedPng(pngDataUrl)
      const page = pdfDoc.getPages()[0]
      page.drawImage(pngImage, { x: SIG_X, y: SIG_Y, width: SIG_W, height: SIG_H })
      savedBytes = await pdfDoc.save()
      currentPdfBytes = savedBytes
      showPdf(savedBytes)
    }

    modal.classList.remove('open')

    const confirmation = document.getElementById('confLabel')?.textContent?.trim() ?? ''
    status.textContent = 'Saving to cloud…'
    status.className = 'status'

    let cloudOk = false
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SAVE_SIGNATURE',
        pdfBase64: uint8ToBase64(savedBytes),
        confirmationNumber: confirmation,
        signaturePng: pngDataUrl,
      })
      cloudOk = result?.ok === true
      if (!cloudOk) console.warn('[FDN RegCard] Cloud save failed:', result?.error)
    } catch (msgErr) {
      console.warn('[FDN RegCard] Could not reach service worker:', msgErr)
    }

    status.textContent = cloudOk
      ? opts.auto
        ? '✓ Signature auto-saved'
        : '✓ Signature saved to cloud'
      : '✓ Signed — cloud save failed (check console)'
    status.className = cloudOk ? 'status ok' : 'status warn'

    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.png'),
        title: 'Guest Signature Complete',
        message: confirmation
          ? `Confirmation ${confirmation} — guest has signed.`
          : 'Guest has signed the registration card.',
      })
    } catch {
      /* ignore */
    }

    await notifySignatureComplete()
    window.setTimeout(() => window.close(), opts.auto ? 600 : 1200)
  } catch (e) {
    console.error('[FDN RegCard] Failed to embed signature:', e)
    status.textContent = 'Failed to embed signature — see console'
    status.className = 'status err'
    signatureSaveInFlight = false
    btn.disabled = false
    btn.textContent = 'Save Signature'
  }
}

void init()
