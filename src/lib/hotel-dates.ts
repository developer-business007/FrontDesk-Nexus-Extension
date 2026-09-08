/**
 * Hotel stay dates: SynXis sends UTC midnight ISO for calendar boundaries.
 * Use the calendar date from the ISO string, not local `Date` shifts.
 */

/** True when SynXis `stay.checkInDate` is a wall-clock time, not a stay date. */
export function isHotelTimeOnlyString(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (/^\d{1,2}:\d{2}(\s*:\d{2})?(\s*[AP]M)?$/i.test(t)) return true
  if (/^\d{1,2}:\d{2}\s*[AP]M$/i.test(t)) return true
  return false
}

/** US `M/D/YYYY` or `MM/DD/YYYY` → `YYYY-MM-DD` (SynXis stay summary text). */
export function parseUsSlashDateToYmd(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim())
  if (!m) return null
  const mo = parseInt(m[1]!, 10)
  const day = parseInt(m[2]!, 10)
  const y = parseInt(m[3]!, 10)
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || y < 1990 || y > 2100) return null
  return `${y}-${pad2(mo)}-${pad2(day)}`
}

/**
 * Normalize a stay boundary for DB / encoder (prefer `YYYY-MM-DD` or UTC ISO).
 * Rejects time-only and bare `M/D` (JS defaults missing years to 2001).
 */
export function normalizeHotelStayDate(
  isoUtc: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (isoUtc?.trim()) {
    const cal = calendarDateFromUtcIso(isoUtc)
    if (cal) return cal
  }

  const raw = (fallback ?? '').trim()
  if (!raw || isHotelTimeOnlyString(raw)) return null

  const fromIso = calendarDateFromUtcIso(raw)
  if (fromIso) return fromIso

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const slash = parseUsSlashDateToYmd(raw)
  if (slash) return slash

  // `5/22` or `05/22` without a year → May 22, 2001 in JS — ignore.
  if (/^\d{1,2}\/\d{1,2}$/.test(raw)) return null

  if (/^\d{12}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }

  return null
}

/** `2026-05-22T00:00:00Z` → `2026-05-22` */
export function calendarDateFromUtcIso(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!m) return null
  const mo = Number(m[2])
  const day = Number(m[3])
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Hotel settings `HH:MM` or legacy hour number → clock components. */
export function resolveDefaultClock(defaultClock: number | string): { hour: number; minute: number } {
  if (typeof defaultClock === 'string') {
    const m = defaultClock.trim().match(/^(\d{1,2}):(\d{2})$/)
    if (m) {
      return {
        hour: Math.max(0, Math.min(23, Number.parseInt(m[1]!, 10))),
        minute: Math.max(0, Math.min(59, Number.parseInt(m[2]!, 10))),
      }
    }
    return { hour: 13, minute: 0 }
  }
  if (typeof defaultClock === 'number' && Number.isFinite(defaultClock)) {
    return { hour: Math.max(0, Math.min(23, Math.floor(defaultClock))), minute: 0 }
  }
  return { hour: 13, minute: 0 }
}

/** Format a local calendar `YYYY-MM-DD` for display (no UTC shift). */
export function formatCalendarDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!m) return isoDate
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return isoDate
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
  }).format(d)
}

/**
 * Normalise check-in/out to SDK `yyyyMMddHHmm`.
 * UTC midnight ISO → hotel calendar date + default clock (local wall clock).
 * Local datetime with an explicit time (e.g. `2026-06-02T08:28:00`, no Z, not midnight)
 * is used as-is — default clock is NOT applied.
 *
 * @param defaultClock hour `14` or Settings `HH:MM` like `13:00`
 */
export function toSdkDatetimeHotel(s: string, defaultClock: number | string): string {
  const t = s.trim()
  if (!t) return t
  if (/^\d{12}$/.test(t)) return t

  const { hour, minute } = resolveDefaultClock(defaultClock)

  // Local ISO datetime with a real time component — preserve it exactly
  const localDt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t)
  if (localDt && !t.endsWith('Z') && !/T00:00:00/.test(t)) {
    return `${localDt[1]}${localDt[2]}${localDt[3]}${localDt[4]}${localDt[5]}`
  }

  const normalized = normalizeHotelStayDate(null, t)
  if (normalized) {
    const [y, mo, d] = normalized.split('-').map(Number)
    const date = new Date(y!, mo! - 1, d!, hour, minute, 0, 0)
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}`
  }

  const cal = calendarDateFromUtcIso(t) ?? (/^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null)
  if (cal && (t.endsWith('Z') || /T00:00:00/.test(t) || t === cal)) {
    const [y, mo, d] = cal.split('-').map(Number)
    const date = new Date(y!, mo! - 1, d!, hour, minute, 0, 0)
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}`
  }

  // Do not `new Date(t)` on arbitrary PMS strings — MM/DD without year becomes year 2001.
  return t
}

/** Parse SDK `yyyyMMddHHmm` to a local Date. */
export function parseSdkDatetime(sdk: string): Date | null {
  const t = sdk.trim()
  if (!/^\d{12}$/.test(t)) return null
  const d = new Date(
    Number(t.slice(0, 4)),
    Number(t.slice(4, 6)) - 1,
    Number(t.slice(6, 8)),
    Number(t.slice(8, 10)),
    Number(t.slice(10, 12)),
    0,
    0,
  )
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Returns an error message when the key validity window is invalid for door locks.
 * Checkout must be strictly after check-in (not same minute / not earlier).
 */
export function validateKeyValidityWindow(
  checkinSdk: string,
  checkoutSdk: string,
): string | null {
  if (!/^\d{12}$/.test(checkinSdk.trim())) {
    return 'Invalid check-in time for key encoding — refresh stay and try again.'
  }
  if (!/^\d{12}$/.test(checkoutSdk.trim())) {
    return 'Missing or invalid checkout / departure — refresh stay so departure date loads before encoding.'
  }
  const ci = parseSdkDatetime(checkinSdk)
  const co = parseSdkDatetime(checkoutSdk)
  if (!ci || !co) {
    return 'Could not parse key check-in/out times — refresh stay and try again.'
  }
  if (co.getTime() <= ci.getTime()) {
    return (
      'Checkout must be after check-in — departure on the card would expire immediately. ' +
      'Refresh stay from PMS and confirm departure date before encoding.'
    )
  }
  // Guard against accidental same-day noon when guest is multi-night (soft: only if checkout is within 2h of checkin)
  const hours = (co.getTime() - ci.getTime()) / 3_600_000
  if (hours < 1) {
    return (
      'Key validity window is under 1 hour — departure looks wrong. ' +
      'Refresh stay and confirm the guest departure date before encoding.'
    )
  }
  return null
}

/** Normalize room numbers for compare (`0230` / `230`). */
export function normalizeRoomNumberForCompare(room: string | null | undefined): string {
  const t = (room ?? '').trim()
  if (!t) return ''
  const digits = t.replace(/\D/g, '')
  if (!digits) return t.toLowerCase()
  return String(Number.parseInt(digits, 10))
}

/**
 * Parse Elox ReadCardCK / encoded_data string (same layout as Python `_parse_card_data`).
 */
export function parseEloxEncodedCard(raw: string): {
  roomNumber: string
  cardSerial: number
  checkinTime: string
  checkoutTime: string
} | null {
  if (raw.length < 47) return null
  try {
    const roomSdk = raw.slice(6, 14)
    const serial = raw.slice(14, 15)
    const checkin = raw.slice(15, 27)
    const coRaw = raw.slice(27, 39)
    const roomNumber = roomSdk.slice(0, 6).replace(/^0+/, '') || '0'
    if (!/^\d+$/.test(roomNumber) || !/^\d{12}$/.test(checkin) || !/^\d{12}$/.test(coRaw)) return null

    const mmInt = Number.parseInt(coRaw.slice(4, 6), 10)
    let checkout = coRaw
    if (mmInt > 12) {
      const month = Number.parseInt(coRaw[5]!, 10)
      checkout = `${coRaw.slice(0, 4)}${pad2(month)}${coRaw.slice(6)}`
    }

    return {
      roomNumber,
      cardSerial: /^\d$/.test(serial) ? Number.parseInt(serial, 10) : 1,
      checkinTime: checkin,
      checkoutTime: checkout,
    }
  } catch {
    return null
  }
}

/**
 * After MakeCard, ensure the written card matches intended room + checkout calendar day.
 */
export function verifyEncodedCardMatches(
  encodedData: string | null | undefined,
  expectedRoom: string,
  expectedCheckoutSdk: string,
): string | null {
  if (!encodedData?.trim()) {
    return 'Key write could not be verified (empty card data) — leave the card on the encoder and try again.'
  }
  const parsed = parseEloxEncodedCard(encodedData.trim())
  if (!parsed) {
    return 'Key write verification failed — card data could not be read. Re-encode with the card flat on the encoder.'
  }
  if (normalizeRoomNumberForCompare(parsed.roomNumber) !== normalizeRoomNumberForCompare(expectedRoom)) {
    return (
      `Card verification failed — wrote room ${expectedRoom} but card reads room ${parsed.roomNumber}. ` +
      'Re-encode with a blank card.'
    )
  }
  const wantDay = expectedCheckoutSdk.trim().slice(0, 8)
  const gotDay = parsed.checkoutTime.slice(0, 8)
  if (wantDay && gotDay && wantDay !== gotDay) {
    return (
      `Card verification failed — checkout date on card (${gotDay}) does not match stay departure (${wantDay}). ` +
      'Refresh stay and re-encode so the key does not expire overnight.'
    )
  }
  return null
}

function formatLocalDateTime(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Date-only stay boundary → local wall time for display (matches encoder defaults). */
function formatCalendarDateWithClock(isoDate: string, defaultClock: number | string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!m) return isoDate
  const { hour, minute } = resolveDefaultClock(defaultClock)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute, 0, 0)
  if (Number.isNaN(d.getTime())) return isoDate
  return formatLocalDateTime(d)
}

/**
 * Human-readable check-in/out for UI (ISO, SDK 12-char, or free text).
 * Date-only values use `defaultClock` (hour or `HH:MM`) so format matches timed strings.
 */
export function formatHotelDateTime(
  s: string | null | undefined,
  defaultClock: number | string = 12,
): string {
  if (!s?.trim()) return '—'
  const t = s.trim()
  if (/^\d{12}$/.test(t)) {
    const d = parseSdkDatetime(t)
    if (d) return formatLocalDateTime(d)
  }
  // Local ISO datetime with a real time component — display as-is, ignore defaultClock
  const localDt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t)
  if (localDt && !t.endsWith('Z') && !/T00:00:00/.test(t)) {
    const [, y, mo, d, h, min] = localDt
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min), 0, 0)
    if (!Number.isNaN(date.getTime())) return formatLocalDateTime(date)
  }
  const normalized = normalizeHotelStayDate(null, t)
  if (normalized) {
    return formatCalendarDateWithClock(normalized, defaultClock)
  }

  const cal = calendarDateFromUtcIso(t) ?? (/^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null)
  if (cal && (t.endsWith('Z') || /T00:00:00/.test(t) || t === cal)) {
    return formatCalendarDateWithClock(cal, defaultClock)
  }

  return t
}
