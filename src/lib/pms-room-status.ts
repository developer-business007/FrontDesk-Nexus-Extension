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
