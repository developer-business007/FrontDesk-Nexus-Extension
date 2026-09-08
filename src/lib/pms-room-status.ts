/** DualPMS / PMS board vacancy helpers (room_operational_status). */

export type PmsOperationalRoomRow = {
  roomNumber: string
  roomType: string | null
  synxisHkStatus: string | null
  synxisOccupancy: string | null
  synxisOooCode: string | null
  ezeeOccupancy: string | null
  blocked: boolean
}

export function stripEzeeOccupancyLabel(o: string | null | undefined): string {
  return (o ?? '').replace(/^1_|^2_|^3_/, '').trim()
}

export function processSynxisOccupancy(o: string | null | undefined): string {
  if (o === 'Reserved') return 'Arriving'
  return o?.trim() ?? ''
}

export type PmsCheckedInRow = {
  synxis_occupancy?: string | null
  ezee_occupancy?: string | null
  ezee_booking_status?: string | null
  merged_guest_name?: string | null
  merged_check_out_date?: string | null
}

/**
 * In-house / checked-in for Dual PMS key encode (excludes Arriving / Reserved).
 * SynXis Occupied, eZee Occupied, or eZee Stayover / Due out / Arrived / Day use.
 */
export function isDualPmsCheckedIn(row: PmsCheckedInRow): boolean {
  const rawSynxis = (row.synxis_occupancy ?? '').trim()
  if (rawSynxis === 'Occupied') return true

  const eOcc = stripEzeeOccupancyLabel(row.ezee_occupancy)
  if (/^occupied$/i.test(eOcc)) return true

  const bs = (row.ezee_booking_status ?? '').toLowerCase().replace(/\s+/g, ' ')
  if (
    /\bstay\s*over\b/.test(bs) ||
    /\bdue\s*out\b/.test(bs) ||
    /\barrived\b/.test(bs) ||
    /\bchecked\s*in\b/.test(bs) ||
    /\bin\s*house\b/.test(bs) ||
    /\bday\s*use\b/.test(bs)
  ) {
    return true
  }

  if (row.merged_guest_name?.trim() && row.merged_check_out_date?.trim()) {
    if (/occup/i.test(eOcc) && !/vacant|arriv|block/i.test(eOcc)) return true
  }

  return false
}

/** True when DualPMS shows the room as sellable / not occupied or blocked in PMS. */
export function isDualPmsVacant(row: PmsOperationalRoomRow): boolean {
  const sOcc = processSynxisOccupancy(row.synxisOccupancy)
  const eOcc = stripEzeeOccupancyLabel(row.ezeeOccupancy)
  if (sOcc === 'Occupied' || row.synxisOccupancy === 'Occupied') return false
  if (sOcc === 'Arriving' || row.synxisOccupancy === 'Reserved') return false
  if (eOcc === 'Occupied') return false
  if (eOcc === 'Blocked') return false
  const ooo = row.synxisOooCode?.trim()
  if (ooo && ooo !== '~' && ooo !== 'FD') return false
  return true
}

/** HK-ready for check-in (SynXis Clean). */
export function isDualPmsHkReady(row: PmsOperationalRoomRow): boolean {
  return row.synxisHkStatus?.trim() === 'Clean'
}

export function isDualPmsAssignable(row: PmsOperationalRoomRow): boolean {
  if (row.blocked) return false
  if (!isDualPmsVacant(row)) return false
  return isDualPmsHkReady(row)
}
