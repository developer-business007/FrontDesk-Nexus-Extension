import type { EzeeGroupMember, EzeeGuestDisplay, ReservationSnapshot } from '../shared/pms-types'
import type { EzeeScrapeFields } from './ezee-drawer-extract'
import { parseEzeeDateTimeToIsoDate } from './ezee-drawer-extract'

/** Matches Supabase `ezee-reservation-detail` edge function response. */
export type EzeeReservationDetail = {
  confirmationNumber: string
  roomNumber: string | null
  checkInDate: string | null
  checkOutDate: string | null
  guestName: string | null
  status: string | null
  totalCharges: number
  paidAmount: number
  dueAmount: number
}

export function formatEzeeMoneyDisplay(amount: number): string {
  if (!Number.isFinite(amount)) return ''
  const fixed = amount.toFixed(2)
  const [whole, frac] = fixed.split('.')
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `$${withCommas}.${frac}`
}

/** Pick which group member matches the scraped main guest / room. */
export function resolveActiveEzeeGroupIndex(
  members: EzeeGroupMember[],
  fields: Pick<EzeeScrapeFields, 'reservationNumber' | 'roomNumber'>,
): number {
  if (members.length === 0) return 0
  const conf = fields.reservationNumber?.trim()
  const room = fields.roomNumber?.trim()
  if (conf) {
    const exact = members.findIndex((m) => m.confirmationNumber === conf)
    if (exact >= 0) return exact
    if (!conf.includes('-')) {
      if (room) {
        const byRoom = members.findIndex((m) => (m.roomNumber ?? '').trim() === room)
        if (byRoom >= 0) return byRoom
      }
      const byPrefix = members.findIndex((m) => m.confirmationNumber.startsWith(`${conf}-`))
      if (byPrefix >= 0) return byPrefix
    }
  }
  if (room) {
    const byRoom = members.findIndex((m) => (m.roomNumber ?? '').trim() === room)
    if (byRoom >= 0) return byRoom
  }
  const arrived = members.findIndex((m) => /arrived|checked\s*in/i.test(m.status ?? ''))
  return arrived >= 0 ? arrived : 0
}

export function applyEzeeGroupMemberToFields(
  fields: EzeeScrapeFields,
  member: EzeeGroupMember,
): EzeeScrapeFields {
  const arrival = member.arrivalDateRaw ?? fields.arrivalDateRaw
  const departure = member.departureDateRaw ?? fields.departureDateRaw
  return {
    ...fields,
    guestName: member.guestName ?? fields.guestName,
    reservationNumber: member.confirmationNumber,
    status: member.status ?? fields.status,
    roomNumber: member.roomNumber ?? fields.roomNumber,
    arrivalDateRaw: arrival,
    departureDateRaw: departure,
    balance: null,
  }
}

export function applyEzeeGroupMemberToReservation(
  baseSnapshot: ReservationSnapshot,
  baseDisplay: EzeeGuestDisplay,
  member: EzeeGroupMember,
  tabUrl: string,
  loadedAt: string,
): { snapshot: ReservationSnapshot; guestDisplay: EzeeGuestDisplay } {
  const arrival = member.arrivalDateRaw
  const departure = member.departureDateRaw
  const stayDatesRaw =
    arrival && departure ? `${arrival} → ${departure}` : baseSnapshot.stayDatesRaw ?? baseDisplay.staySummary

  const snapshot: ReservationSnapshot = {
    ...baseSnapshot,
    confirmationNumber: member.confirmationNumber,
    guestName: member.guestName ?? baseSnapshot.guestName,
    roomNumber: member.roomNumber ?? baseSnapshot.roomNumber,
    checkInDate: parseEzeeDateTimeToIsoDate(arrival) ?? baseSnapshot.checkInDate,
    checkOutDate: parseEzeeDateTimeToIsoDate(departure) ?? baseSnapshot.checkOutDate,
    stayDatesRaw,
    pmsStatus: member.status ?? baseSnapshot.pmsStatus,
    dueAmount: null,
    loadedAt,
    pageUrl: tabUrl,
  }

  const guestDisplay: EzeeGuestDisplay = {
    ...baseDisplay,
    nameLine: member.guestName ?? baseDisplay.nameLine,
    reservationNumber: member.confirmationNumber,
    status: member.status ?? baseDisplay.status,
    roomNumber: member.roomNumber ?? baseDisplay.roomNumber,
    staySummary: arrival && departure ? `${arrival} → ${departure}` : baseDisplay.staySummary,
    balance: null,
  }

  return { snapshot, guestDisplay }
}

function isoToEzeeStayRaw(iso: string | null): string | null {
  if (!iso?.trim()) return null
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}):(\d{2})(?::\d{2})?)?/)
  if (!m) return iso
  const [, yyyy, mm, dd, h, min] = m
  if (!h) return `${mm}-${dd}-${yyyy}`
  const hour = Number(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${mm}-${dd}-${yyyy} ${h12}:${min} ${ampm}`
}

export function memberFromEzeeReservationDetail(
  member: EzeeGroupMember,
  detail: EzeeReservationDetail,
): EzeeGroupMember {
  return {
    ...member,
    confirmationNumber: detail.confirmationNumber,
    roomNumber: detail.roomNumber ?? member.roomNumber,
    guestName: detail.guestName ?? member.guestName,
    arrivalDateRaw: isoToEzeeStayRaw(detail.checkInDate) ?? member.arrivalDateRaw,
    departureDateRaw: isoToEzeeStayRaw(detail.checkOutDate) ?? member.departureDateRaw,
    status: detail.status ?? member.status,
  }
}

export function reservationFromEzeeReservationDetail(
  baseSnapshot: ReservationSnapshot,
  detail: EzeeReservationDetail,
  tabUrl: string,
  loadedAt: string,
): ReservationSnapshot {
  const arrivalRaw = isoToEzeeStayRaw(detail.checkInDate)
  const departureRaw = isoToEzeeStayRaw(detail.checkOutDate)
  const stayDatesRaw =
    arrivalRaw && departureRaw ? `${arrivalRaw} → ${departureRaw}` : baseSnapshot.stayDatesRaw

  return {
    ...baseSnapshot,
    confirmationNumber: detail.confirmationNumber,
    guestName: detail.guestName ?? baseSnapshot.guestName,
    roomNumber: detail.roomNumber ?? null,
    checkInDate: detail.checkInDate ?? baseSnapshot.checkInDate,
    checkOutDate: detail.checkOutDate ?? baseSnapshot.checkOutDate,
    stayDatesRaw,
    pmsStatus: detail.status ?? baseSnapshot.pmsStatus,
    reservationTotal: String(detail.totalCharges),
    amountPaid: String(detail.paidAmount),
    dueAmount: String(detail.dueAmount),
    loadedAt,
    pageUrl: tabUrl,
  }
}

export function displayFromEzeeReservationDetail(
  baseDisplay: EzeeGuestDisplay,
  detail: EzeeReservationDetail,
): EzeeGuestDisplay {
  const arrivalRaw = isoToEzeeStayRaw(detail.checkInDate)
  const departureRaw = isoToEzeeStayRaw(detail.checkOutDate)
  const staySummary =
    arrivalRaw && departureRaw ? `${arrivalRaw} → ${departureRaw}` : baseDisplay.staySummary

  return {
    ...baseDisplay,
    nameLine: detail.guestName ?? baseDisplay.nameLine,
    reservationNumber: detail.confirmationNumber,
    status: detail.status ?? baseDisplay.status,
    roomNumber: detail.roomNumber ?? null,
    staySummary,
    total: formatEzeeMoneyDisplay(detail.totalCharges),
    paid: formatEzeeMoneyDisplay(detail.paidAmount),
    balance: formatEzeeMoneyDisplay(detail.dueAmount),
  }
}
