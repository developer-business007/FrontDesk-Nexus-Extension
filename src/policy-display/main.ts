import policyImageUrl from './hotel-policy-review.png'

/** Shrink slightly so the full page fits with no scrollbars (OS fullscreen rounding). */
const VIEWPORT_INSET = 0.96

/** Move this window to the guest display and enter presentation/fullscreen mode (F11-like). */
async function enterGuestDisplayFullscreen(): Promise<void> {
  try {
    const displays = await chrome.system.display.getInfo()
    const second = displays.find((d) => !d.isPrimary) ?? displays[1]
    const win = await chrome.windows.getCurrent()
    if (win.id === undefined) return

    if (second) {
      await chrome.windows.update(win.id, {
        left: second.workArea.left,
        top: second.workArea.top,
        width: second.workArea.width,
        height: second.workArea.height,
        state: 'normal',
        focused: true,
      })
    }

    await chrome.windows.update(win.id, { state: 'fullscreen', focused: true })
  } catch (e) {
    console.warn('[FDN Policy] chrome.windows fullscreen failed:', e)
  }

  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    }
  } catch {
    /* chrome.windows fullscreen is the primary path */
  }

  try {
    window.focus()
  } catch {
    /* ignore */
  }
}

/** Scale the policy image to fit entirely inside the viewport — no scrollbars. */
function fitPolicyToViewport(): void {
  const img = document.querySelector<HTMLImageElement>('.policy-sheet')
  if (!img?.naturalWidth || !img.naturalHeight) return

  const vw = window.innerWidth
  const vh = window.innerHeight
  const scale = Math.min(vw / img.naturalWidth, vh / img.naturalHeight) * VIEWPORT_INSET

  img.style.width = `${Math.floor(img.naturalWidth * scale)}px`
  img.style.height = `${Math.floor(img.naturalHeight * scale)}px`
}

async function init(): Promise<void> {
  const img = document.querySelector<HTMLImageElement>('.policy-sheet')
  if (!img) return

  img.src = policyImageUrl
  img.addEventListener('load', fitPolicyToViewport)
  window.addEventListener('resize', fitPolicyToViewport)
  if (img.complete) fitPolicyToViewport()

  await enterGuestDisplayFullscreen()
  // Re-measure after fullscreen transition settles.
  window.setTimeout(fitPolicyToViewport, 120)
  window.setTimeout(fitPolicyToViewport, 400)
}

void init()
