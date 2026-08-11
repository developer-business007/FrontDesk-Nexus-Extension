import {
  DUALPMS_UPSTREAM_STALE_SEC,
  PMS_STALE_SYNC_THRESHOLD_SEC,
  type PmsBoardRow,
  type PmsSyncFreshness,
  type PmsSyncRunResult,
  type PmsSyncState,
} from '../shared/pms-board-types'

export function secondsAgo(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((nowMs - t) / 1000))
}

function formatStaleAge(secondsAgoVal: number | null): string {
  if (secondsAgoVal == null) return 'never synced'
  if (secondsAgoVal < 60) return `${secondsAgoVal}s ago`
  const mins = Math.floor(secondsAgoVal / 60)
  const secs = secondsAgoVal % 60
  return secs > 0 ? `${mins}m ${secs}s ago` : `${mins}m ago`
}

export function evaluatePmsSyncFreshness(
  syncState: PmsSyncState | undefined,
  lastSync: PmsSyncRunResult | null,
  nowMs: number,
  thresholdSec = PMS_STALE_SYNC_THRESHOLD_SEC,
  upstreamStaleSec = DUALPMS_UPSTREAM_STALE_SEC,
): PmsSyncFreshness {
  const synxisSecondsAgo = secondsAgo(syncState?.synxis?.synced_at, nowMs)
  const ezeeSecondsAgo = secondsAgo(syncState?.ezee?.synced_at, nowMs)
  const synxisPollAgo = secondsAgo(syncState?.synxis?.dualpms_polled_at, nowMs)
  const ezeePollAgo = secondsAgo(syncState?.ezee?.dualpms_polled_at, nowMs)

  const synxisSource = syncState?.synxis?.source ?? null
  const ezeeSource = syncState?.ezee?.source ?? null
  const synxisFallback = synxisSource != null && synxisSource !== 'dualpms_vps'
  const ezeeFallback = ezeeSource != null && ezeeSource !== 'dualpms_vps'
  const fallbackActive = synxisFallback || ezeeFallback

  const issues: PmsSyncFreshness['issues'] = []
  const warnings: string[] = []

  if (synxisFallback) {
    const label =
      synxisSource === 'cookie_backup'
        ? 'extension browser cookie'
        : synxisSource === 'synxis_api_credentials'
          ? 'script login'
          : 'API fallback'
    warnings.push(`SynXis: DualPMS upstream stale — data via ${label}`)
    issues.push({
      system: 'SynXis',
      secondsAgo: synxisSecondsAgo,
      stale: false,
      reason: 'fallback',
      detail: `Backup mode (${label}) — DualPMS poll ${
        synxisPollAgo != null ? `${synxisPollAgo}s ago` : 'never'
      }`,
    })
  }

  if (ezeeFallback) {
    warnings.push('eZee: DualPMS upstream stale — data via direct eZee API')
    issues.push({
      system: 'eZee',
      secondsAgo: ezeeSecondsAgo,
      stale: false,
      reason: 'fallback',
      detail: `Backup mode (eZee API) — DualPMS poll ${
        ezeePollAgo != null ? `${ezeePollAgo}s ago` : 'never'
      }`,
    })
  }

  if (synxisSecondsAgo == null) {
    issues.push({
      system: 'SynXis',
      secondsAgo: null,
      stale: true,
      reason: 'missing',
      detail: 'VPS bridge not running — check PM2 on DualPMS server',
    })
  } else if (synxisSecondsAgo > thresholdSec) {
    issues.push({
      system: 'SynXis',
      secondsAgo: synxisSecondsAgo,
      stale: true,
      reason: 'stale',
      detail: `VPS bridge stale (${formatStaleAge(synxisSecondsAgo)})`,
    })
  } else if (!synxisFallback && synxisPollAgo != null && synxisPollAgo > upstreamStaleSec) {
    warnings.push(`SynXis: DualPMS upstream poll stale (${formatStaleAge(synxisPollAgo)})`)
  }

  if (ezeeSecondsAgo == null) {
    issues.push({
      system: 'eZee',
      secondsAgo: null,
      stale: true,
      reason: 'missing',
      detail: 'No eZee data in Supabase yet — start VPS bridge',
    })
  } else if (ezeeSecondsAgo > thresholdSec) {
    issues.push({
      system: 'eZee',
      secondsAgo: ezeeSecondsAgo,
      stale: true,
      reason: 'stale',
      detail: `VPS bridge stale (${formatStaleAge(ezeeSecondsAgo)})`,
    })
  } else if (lastSync && !lastSync.ezee.ok) {
    issues.push({
      system: 'eZee',
      secondsAgo: ezeeSecondsAgo,
      stale: true,
      reason: 'failed',
      detail: lastSync.ezee.error ?? 'Sync failed',
    })
  } else if (!ezeeFallback && ezeePollAgo != null && ezeePollAgo > upstreamStaleSec) {
    warnings.push(`eZee: DualPMS upstream poll stale (${formatStaleAge(ezeePollAgo)})`)
  }

  return {
    synxisSecondsAgo,
    ezeeSecondsAgo,
    issues: issues.filter((i) => i.stale),
    warnings,
    anyStale: issues.some((i) => i.stale),
    fallbackActive,
  }
}

export function syncAgeClass(secondsAgoVal: number | null, thresholdSec = PMS_STALE_SYNC_THRESHOLD_SEC): string {
  if (secondsAgoVal == null) return 'fdn-dualpms__age--stale'
  if (secondsAgoVal > thresholdSec) return 'fdn-dualpms__age--stale'
  if (secondsAgoVal > 30) return 'fdn-dualpms__age--warn'
  return 'fdn-dualpms__age--ok'
}

export function humanShortDate(d: string | null | undefined): string {
  if (!d) return ''
  const monthNames: Record<string, string> = {
    '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
    '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
  }
  const month = d.slice(5, 7)
  const day = d.slice(8, 10)
  return `${monthNames[month] ?? month} ${day}`
}

export function parsePmsCents(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** Merged balance with SynXis → eZee fallback (matches bridge mergeGuest). */
export function resolveBalanceCents(
  row: Pick<PmsBoardRow, 'merged_balance_cents' | 'synxis_balance_cents' | 'ezee_balance_cents'>,
): number | null {
  const merged = parsePmsCents(row.merged_balance_cents)
  if (merged != null) return merged
  const synxis = parsePmsCents(row.synxis_balance_cents)
  if (synxis != null) return synxis
  return parsePmsCents(row.ezee_balance_cents)
}

export function folioFromCents(cents: unknown): number | null {
  const normalized = parsePmsCents(cents)
  if (normalized === 0) return 0
  if (normalized == null) return null
  return normalized / 100
}

export function folioFromBoardRow(row: PmsBoardRow): number | null {
  return folioFromCents(resolveBalanceCents(row))
}

export type PmsRowColor = 'reddish' | 'greenish' | 'grayish' | 'whitish' | ''

export function rowColor(row: PmsBoardRow): PmsRowColor {
  const sOcc = row.synxis_occupancy
  const eOcc = row.ezee_occupancy
  if (sOcc === 'Occupied' || sOcc === 'Reserved') return 'reddish'
  if (eOcc === 'Occupied') return 'reddish'
  if (sOcc === 'Vacant' && eOcc === 'Vacant' && row.synxis_hk_status === 'Dirty') return 'grayish'
  if (sOcc === 'Vacant' && eOcc === 'Vacant' && row.synxis_hk_status === 'Clean') return 'greenish'
  const ooo = row.synxis_ooo_code
  if (ooo && ooo !== 'FD' && ooo !== '~') return 'whitish'
  return ''
}

export const PMS_ROW_TINT_CLASS: Record<PmsRowColor, string> = {
  reddish: 'fdn-dualpms__row--reddish',
  greenish: 'fdn-dualpms__row--greenish',
  grayish: 'fdn-dualpms__row--grayish',
  whitish: 'fdn-dualpms__row--whitish',
  '': '',
}

export function hkStatusBadgeClass(status: string | null): string {
  if (status === 'Clean') return 'fdn-dualpms__badge fdn-dualpms__badge--hk-clean'
  if (status === 'Dirty') return 'fdn-dualpms__badge fdn-dualpms__badge--hk-dirty'
  return ''
}

export function synxisOccBadgeClass(occupancy: string | null): string {
  const label = processSynxisOccupancy(occupancy)
  if (label === 'Occupied' || occupancy === 'Occupied') {
    return 'fdn-dualpms__badge fdn-dualpms__badge--occ-occupied'
  }
  if (label === 'Arriving' || occupancy === 'Reserved') {
    return 'fdn-dualpms__badge fdn-dualpms__badge--occ-arriving'
  }
  if (label === 'Vacant' || occupancy === 'Vacant') {
    return 'fdn-dualpms__badge fdn-dualpms__badge--occ-vacant'
  }
  return ''
}

export function ezeeOccBadgeClass(occupancy: string | null): string {
  const label = stripEzeeSortKey(occupancy)
  if (label === 'Occupied') return 'fdn-dualpms__badge fdn-dualpms__badge--occ-occupied'
  if (label === 'Blocked') return 'fdn-dualpms__badge fdn-dualpms__badge--occ-blocked'
  if (label === 'Vacant') return 'fdn-dualpms__badge fdn-dualpms__badge--occ-vacant'
  return ''
}

export function processSynxisOccupancy(o: string | null): string {
  if (o === 'Reserved') return 'Arriving'
  return o ?? ''
}

export function ezeeOccupancySortKey(o: string | null): string {
  if (o === 'Occupied') return '1_Occupied'
  if (o === 'Blocked') return '2_Blocked'
  if (o === 'Vacant') return '3_Vacant'
  return `9_${o ?? ''}`
}

export function stripEzeeSortKey(o: string | null): string {
  return (o ?? '').replace(/^1_|^2_|^3_/, '')
}

export function guestNameClass(soldBy: string | null): string {
  if (soldBy === 'synxis') return 'fdn-dualpms__guest--synxis'
  if (soldBy === 'ezee') return 'fdn-dualpms__guest--ezee'
  return ''
}
