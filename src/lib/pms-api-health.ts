import type { PmsBoardRow, PmsSyncState } from '../shared/pms-board-types'

export type PmsApiHealthStatus = 'ok' | 'partial' | 'failed' | 'unknown'

export type PmsSystemApiHealth = {
  system: 'SynXis' | 'eZee'
  status: PmsApiHealthStatus
  sourceLabel: string
  roomsWithOccupancy: number
  roomsWithHk: number
  inventoryRooms: number
  detail: string
}

export type PmsApiHealthSnapshot = {
  synxis: PmsSystemApiHealth
  ezee: PmsSystemApiHealth
}

function formatSource(source: string | null | undefined): string {
  switch (source) {
    case 'dualpms_vps':
      return 'DualPMS'
    case 'cookie_backup':
      return 'browser cookie'
    case 'synxis_api_credentials':
      return 'script login'
    case 'ezee_api_fallback':
      return 'eZee API'
    default:
      return source ?? '—'
  }
}

function countFields(rows: PmsBoardRow[], system: 'synxis' | 'ezee') {
  let occupancy = 0
  let hk = 0
  for (const row of rows) {
    const occ = system === 'synxis' ? row.synxis_occupancy : row.ezee_occupancy
    const hkVal = system === 'synxis' ? row.synxis_hk_status : row.ezee_hk_status
    if (occ) occupancy += 1
    if (hkVal) hk += 1
  }
  return { occupancy, hk }
}

function buildHealth(
  system: 'SynXis' | 'eZee',
  source: string | null | undefined,
  stored: PmsSyncState['synxis'] | PmsSyncState['ezee'] | undefined,
  counts: { occupancy: number; hk: number },
  inventoryRooms: number,
): PmsSystemApiHealth {
  const storedStatus = stored?.api?.status
  let status: PmsApiHealthStatus =
    storedStatus === 'ok' || storedStatus === 'partial' || storedStatus === 'failed'
      ? storedStatus
      : 'unknown'
  if (status === 'unknown') {
    if (inventoryRooms <= 0) status = 'unknown'
    else if (counts.occupancy === 0) status = 'failed'
    else if (counts.occupancy < inventoryRooms * 0.85) status = 'partial'
    else status = 'ok'
  }

  const detail =
    stored?.api?.detail?.trim() ||
    `${counts.occupancy}/${inventoryRooms} rooms with ${system === 'SynXis' ? 'S.OCC' : 'E.OCC'}`

  return {
    system,
    status,
    sourceLabel: formatSource(source),
    roomsWithOccupancy: counts.occupancy,
    roomsWithHk: counts.hk,
    inventoryRooms,
    detail,
  }
}

export function evaluatePmsApiHealth(
  rows: PmsBoardRow[],
  syncState: PmsSyncState | undefined,
  inventoryRooms: number,
): PmsApiHealthSnapshot {
  return {
    synxis: buildHealth(
      'SynXis',
      syncState?.synxis?.source,
      syncState?.synxis,
      countFields(rows, 'synxis'),
      inventoryRooms,
    ),
    ezee: buildHealth(
      'eZee',
      syncState?.ezee?.source,
      syncState?.ezee,
      countFields(rows, 'ezee'),
      inventoryRooms,
    ),
  }
}

export function apiHealthClass(status: PmsApiHealthStatus): string {
  if (status === 'ok') return 'fdn-dualpms__api--ok'
  if (status === 'partial') return 'fdn-dualpms__api--partial'
  if (status === 'failed') return 'fdn-dualpms__api--failed'
  return 'fdn-dualpms__api--unknown'
}
