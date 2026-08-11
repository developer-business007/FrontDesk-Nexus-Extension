import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconRefresh } from './WorkspaceIcons'
import { PmsHousekeepingDialog, type PmsHkRequestChoice } from './PmsHousekeepingDialog'
import {
  DEFAULT_ROOMTYPE_TOTALS,
  PMS_STALE_SYNC_THRESHOLD_SEC,
  type PmsBoardRow,
  type PmsRoomtypeCounts,
  type PmsSoldBy,
  type PmsSyncRunResult,
  type PmsSyncState,
} from '../shared/pms-board-types'
import { apiHealthClass, evaluatePmsApiHealth } from '../lib/pms-api-health'
import { ROOM_TYPES } from '../lib/room-types'
import {
  evaluatePmsSyncFreshness,
  ezeeOccBadgeClass,
  ezeeOccupancySortKey,
  folioFromBoardRow,
  guestNameClass,
  hkStatusBadgeClass,
  humanShortDate,
  PMS_ROW_TINT_CLASS,
  processSynxisOccupancy,
  rowColor,
  secondsAgo,
  stripEzeeSortKey,
  syncAgeClass,
  synxisOccBadgeClass,
} from '../lib/pms-board-display'

const PMS_SYNC_INTERVAL_MS = 10_000

type SortKey =
  | 'room_number'
  | 'room_type'
  | 'synxis_hk_status'
  | 'synxis_ooo_code'
  | 'synxis_occupancy'
  | 'ezee_occupancy'
  | 'merged_guest_name'
  | 'merged_check_in_date'
  | 'merged_check_out_date'
  | 'folio'

type FilterState = {
  room_types: string[]
  synxis_hk: string[]
  synxis_ooo: string[]
  synxis_occ: string[]
  ezee_occ: string[]
  sold_by: PmsSoldBy[]
}

type EnrichedPmsRow = PmsBoardRow & {
  folio: number | null
  color: ReturnType<typeof rowColor>
  ezee_sort: string
}

function defaultFilter(): FilterState {
  return {
    room_types: [...ROOM_TYPES],
    synxis_hk: ['Clean', 'Dirty'],
    synxis_ooo: ['ooo', 'functional'],
    synxis_occ: ['Vacant', 'Occupied', 'Reserved'],
    ezee_occ: ['Occupied', 'Blocked', 'Vacant'],
    sold_by: ['synxis', 'ezee', 'neither'],
  }
}

function matchesFilter(row: PmsBoardRow, f: FilterState): boolean {
  if (f.room_types.length === 0) return false
  const rt = row.room_type ?? ''
  if (rt && !f.room_types.includes(rt)) return false
  if (!rt && f.room_types.length < ROOM_TYPES.length) return false

  const hk = row.synxis_hk_status
  if (hk && !f.synxis_hk.includes(hk)) return false

  const ooo = row.synxis_ooo_code
  const isOoo = Boolean(ooo && ooo !== '~' && ooo !== 'FD')
  if (isOoo && !f.synxis_ooo.includes('ooo')) return false
  if (!isOoo && !f.synxis_ooo.includes('functional')) return false

  const sOcc = row.synxis_occupancy
  if (sOcc) {
    const sOccOk =
      f.synxis_occ.includes(sOcc) ||
      (f.synxis_occ.includes('Occupied') && sOcc === 'Reserved')
    if (!sOccOk) return false
  }

  const eOcc = row.ezee_occupancy
  if (eOcc && !f.ezee_occ.includes(eOcc)) return false

  if (row.sold_by && !f.sold_by.includes(row.sold_by)) return false

  return true
}

function rowSearchHaystack(row: EnrichedPmsRow): string {
  const parts = [
    row.room_number,
    row.room_type,
    row.synxis_hk_status,
    row.synxis_ooo_code && row.synxis_ooo_code !== '~' ? row.synxis_ooo_code : '',
    processSynxisOccupancy(row.synxis_occupancy),
    row.synxis_occupancy,
    stripEzeeSortKey(row.ezee_occupancy),
    row.ezee_occupancy,
    row.merged_guest_name,
    row.synxis_guest_name,
    row.ezee_guest_name,
    humanShortDate(row.merged_check_in_date),
    humanShortDate(row.merged_check_out_date),
    row.folio != null ? String(row.folio) : '',
    row.sold_by,
  ]
  return parts.filter(Boolean).join(' ').toLowerCase()
}

function matchesSearch(row: EnrichedPmsRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return rowSearchHaystack(row).includes(q)
}

function StatusBadge({ label, badgeClass }: { label: string; badgeClass: string }) {
  if (!label) return null
  if (!badgeClass) return <>{label}</>
  return <span className={badgeClass}>{label}</span>
}

function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

function filterIsDefault(f: FilterState): boolean {
  const d = defaultFilter()
  return (
    f.room_types.length === d.room_types.length &&
    f.synxis_hk.length === d.synxis_hk.length &&
    f.synxis_ooo.length === d.synxis_ooo.length &&
    f.synxis_occ.length === d.synxis_occ.length &&
    f.ezee_occ.length === d.ezee_occ.length &&
    f.sold_by.length === d.sold_by.length
  )
}

type DualPmsPanelProps = {
  signedIn: boolean
}

export function DualPmsPanel({ signedIn }: DualPmsPanelProps) {
  const [boardRows, setBoardRows] = useState<PmsBoardRow[]>([])
  const [roomNumbers, setRoomNumbers] = useState<string[]>([])
  const [syncState, setSyncState] = useState<PmsSyncState>({})
  const [roomtypeCounts, setRoomtypeCounts] = useState<PmsRoomtypeCounts>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<PmsSyncRunResult | null>(null)
  const syncInFlight = useRef(false)

  const [nowMs, setNowMs] = useState(() => Date.now())
  const [sortBy, setSortBy] = useState<SortKey>('room_number')
  const [sortAsc, setSortAsc] = useState(true)
  const [filter, setFilter] = useState<FilterState>(defaultFilter)
  const [searchQuery, setSearchQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [showAvailability, setShowAvailability] = useState(false)
  const [selectedRooms, setSelectedRooms] = useState<string[]>([])
  const [hkDialogOpen, setHkDialogOpen] = useState(false)
  const [hkRequestStatus, setHkRequestStatus] = useState<PmsHkRequestChoice>(0)
  const [hkBusy, setHkBusy] = useState(false)
  const [hkError, setHkError] = useState<string | null>(null)
  const [hkMessage, setHkMessage] = useState<string | null>(null)

  const closeHkDialog = useCallback(() => {
    setHkDialogOpen(false)
    setHkError(null)
    setHkRequestStatus(0)
  }, [])

  const clearHkSelection = useCallback(() => {
    setSelectedRooms([])
    setHkRequestStatus(0)
    setHkError(null)
    setHkDialogOpen(false)
  }, [])

  const toggleRoomSelection = useCallback((roomNumber: string, checked: boolean) => {
    setShowAvailability(false)
    setHkMessage(null)
    setHkError(null)
    const key = roomNumber.trim()
    setSelectedRooms((prev) =>
      checked ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((r) => r !== key),
    )
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearHkSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearHkSelection])

  const loadBoardData = useCallback(async () => {
    if (!signedIn) {
      setBoardRows([])
      setRoomNumbers([])
      setLoading(false)
      return
    }
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'GET_PMS_BOARD_DATA' })) as {
        ok: boolean
        pmsBoardData?: {
          roomNumbers: string[]
          boardRows: PmsBoardRow[]
          syncState: PmsSyncState
          roomtypeCounts: PmsRoomtypeCounts
        }
        error?: string
      }
      if (!res.ok) {
        setError(res.error ?? 'Could not load Dual PMS board')
        return
      }
      const data = res.pmsBoardData
      if (data) {
        setBoardRows(data.boardRows)
        setRoomNumbers(data.roomNumbers)
        setSyncState(data.syncState)
        setRoomtypeCounts(data.roomtypeCounts)
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Dual PMS board')
    } finally {
      setLoading(false)
    }
  }, [signedIn])

  const sendHousekeepingRequest = useCallback(async () => {
    if (!signedIn || hkRequestStatus === 0 || selectedRooms.length === 0) return
    setHkBusy(true)
    setHkError(null)
    setHkMessage(null)
    const status = hkRequestStatus === 2 ? 'clean' : 'dirty'
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'REQUEST_PMS_HOUSEKEEPING',
        roomNumbers: selectedRooms,
        status,
      })) as { ok: boolean; hkMessage?: string; error?: string }
      if (!res.ok) {
        setHkError(res.error ?? 'Housekeeping request failed')
        return
      }
      setHkMessage(res.hkMessage ?? `Queued ${selectedRooms.length} room(s) to mark ${status}.`)
      clearHkSelection()
      void loadBoardData()
    } catch (e) {
      setHkError(e instanceof Error ? e.message : 'Housekeeping request failed')
    } finally {
      setHkBusy(false)
    }
  }, [clearHkSelection, hkRequestStatus, loadBoardData, selectedRooms, signedIn])

  const runPmsSyncJob = useCallback(async () => {
    if (!signedIn || syncInFlight.current) return
    syncInFlight.current = true
    setSyncing(true)
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'TRIGGER_PMS_SYNC' })) as {
        ok: boolean
        pmsSyncResult?: PmsSyncRunResult
        error?: string
      }
      if (res.ok && res.pmsSyncResult) {
        setLastSync(res.pmsSyncResult)
        setSyncError(null)
      } else if (!res.ok) {
        setSyncError(res.error ?? 'PMS sync failed')
      }
      await loadBoardData()
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'PMS sync failed')
    } finally {
      syncInFlight.current = false
      setSyncing(false)
    }
  }, [signedIn, loadBoardData])

  useEffect(() => {
    void loadBoardData()
  }, [loadBoardData])

  useEffect(() => {
    if (!signedIn) return
    void loadBoardData()
    const id = window.setInterval(() => void loadBoardData(), PMS_SYNC_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [signedIn, loadBoardData])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const inventoryConfigured = roomNumbers.length > 0

  const enriched = useMemo(() => {
    const rows = inventoryConfigured ? boardRows : []
    return rows.map((row) => ({
      ...row,
      folio: folioFromBoardRow(row),
      color: rowColor(row),
      ezee_sort: ezeeOccupancySortKey(row.ezee_occupancy),
    }))
  }, [boardRows, inventoryConfigured])

  const afterColumnFilter = useMemo(
    () => enriched.filter((r) => matchesFilter(r, filter)),
    [enriched, filter],
  )

  const visible = useMemo(() => {
    if (!searchQuery.trim()) return afterColumnFilter
    return afterColumnFilter.filter((r) => matchesSearch(r, searchQuery))
  }, [afterColumnFilter, searchQuery])

  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1
    return [...visible].sort((a, b) => {
      let av: string | number | null
      let bv: string | number | null
      switch (sortBy) {
        case 'room_number':
          av = parseInt(a.room_number, 10)
          bv = parseInt(b.room_number, 10)
          break
        case 'folio':
          av = a.folio
          bv = b.folio
          break
        case 'ezee_occupancy':
          av = a.ezee_sort
          bv = b.ezee_sort
          break
        default:
          av = (a[sortBy] as string | null) ?? ''
          bv = (b[sortBy] as string | null) ?? ''
      }
      if (av == null && bv == null) return 0
      if (av == null) return dir
      if (bv == null) return -dir
      if (av < bv) return -dir
      if (av > bv) return dir
      return 0
    })
  }, [visible, sortBy, sortAsc])

  const visibleRoomNumbers = useMemo(() => sorted.map((r) => r.room_number), [sorted])

  const allVisibleSelected =
    visibleRoomNumbers.length > 0 &&
    visibleRoomNumbers.every((r) => selectedRooms.includes(r))

  const someVisibleSelected =
    visibleRoomNumbers.some((r) => selectedRooms.includes(r)) && !allVisibleSelected

  const toggleSelectAllVisible = useCallback(
    (checked: boolean) => {
      setShowAvailability(false)
      setHkMessage(null)
      setHkError(null)
      setSelectedRooms((prev) => {
        if (checked) {
          return [...new Set([...prev, ...visibleRoomNumbers])]
        }
        return prev.filter((r) => !visibleRoomNumbers.includes(r))
      })
    },
    [visibleRoomNumbers],
  )

  const availabilityCounters = useMemo(() => {
    const total = { ...DEFAULT_ROOMTYPE_TOTALS }
    const ooo: Record<string, number> = {}
    const occupied: Record<string, number> = {}
    for (const t of ROOM_TYPES) {
      ooo[t] = 0
      occupied[t] = 0
    }
    for (const row of enriched) {
      const rt = row.room_type ?? ''
      if (!ROOM_TYPES.includes(rt as (typeof ROOM_TYPES)[number])) continue
      const code = row.synxis_ooo_code
      if (code && code !== '~' && code !== 'FD') {
        ooo[rt] = (ooo[rt] ?? 0) + 1
      }
    }
    const syncTotals = roomtypeCounts?.totals
    for (const t of ROOM_TYPES) {
      occupied[t] = syncTotals?.[t] ?? 0
    }
    const available: Record<string, number> = {}
    for (const t of ROOM_TYPES) {
      available[t] = (total[t] ?? 0) - (ooo[t] ?? 0) - (occupied[t] ?? 0)
    }
    return [
      { label: 'Total', values: total },
      { label: 'Out of Order', values: ooo },
      { label: 'Reserved', values: occupied },
      { label: 'Available', values: available },
    ]
  }, [enriched, roomtypeCounts])

  const toggleSort = useCallback((key: SortKey) => {
    setSortBy((prev) => {
      if (prev === key) {
        setSortAsc((d) => !d)
        return prev
      }
      setSortAsc(true)
      return key
    })
  }, [])

  const synxisAgo = secondsAgo(syncState?.synxis?.synced_at, nowMs)
  const synxisSource = syncState?.synxis?.source ?? null
  const ezeeAgo = secondsAgo(
    syncState?.ezee?.synced_at ?? (lastSync?.ezee.ok ? lastSync.at : null),
    nowMs,
  )
  const syncFreshness = useMemo(
    () => evaluatePmsSyncFreshness(syncState, lastSync, nowMs),
    [syncState, lastSync, nowMs],
  )
  const apiHealth = useMemo(
    () => evaluatePmsApiHealth(enriched, syncState, roomNumbers.length || enriched.length),
    [enriched, syncState, roomNumbers.length],
  )
  const synxisIssue = syncFreshness.issues.find((i) => i.system === 'SynXis')
  const synxisFailed = Boolean(synxisIssue)
  const ezeeFailed = Boolean(lastSync && !lastSync.ezee.ok)
  const hotelDate = syncState?.synxis?.hotel_date
  const totalRooms = roomNumbers.length || sorted.length
  const filteredCount = sorted.length
  const hasActiveSearch = Boolean(searchQuery.trim())
  const columnFiltersActive = !filterIsDefault(filter) || afterColumnFilter.length !== enriched.length
  const showingSubset = filteredCount !== totalRooms

  const applyVacantCleanPreset = () => {
    setFilter({
      ...defaultFilter(),
      synxis_occ: ['Vacant'],
      ezee_occ: ['Vacant'],
      synxis_hk: ['Clean'],
    })
  }

  const applyVacantPreset = () => {
    setFilter({
      ...defaultFilter(),
      synxis_occ: ['Vacant'],
      ezee_occ: ['Vacant'],
    })
  }

  if (!signedIn) {
    return (
      <section className="fdn-panel fdn-panel--dualpms" aria-label="Dual PMS">
        <p className="fdn-dualpms__hint">Sign in to view the Dual PMS room board.</p>
      </section>
    )
  }

  return (
    <section className="fdn-panel fdn-panel--dualpms" aria-label="Dual PMS">
      <div className="fdn-dualpms__header">
        <ul className="fdn-dualpms__status-bar">
          <li>
            SynXis:{' '}
            {synxisFailed ? (
              <span className="fdn-dualpms__age--stale">{synxisIssue?.detail}</span>
            ) : (
              <>
                <span className={syncAgeClass(synxisAgo)}>
                  {synxisAgo != null ? String(synxisAgo).padStart(2, '0') : '—'}
                </span>
                s
                {synxisSource && synxisSource !== 'dualpms_vps' ? ` (${synxisSource})` : ''}
              </>
            )}
          </li>
          <li>
            eZee:{' '}
            {ezeeFailed ? (
              <span className="fdn-dualpms__age--stale">{lastSync?.ezee.error ?? 'Failed'}</span>
            ) : (
              <>
                <span className={syncAgeClass(ezeeAgo)}>
                  {ezeeAgo != null ? String(ezeeAgo).padStart(2, '0') : '—'}
                </span>
                s
              </>
            )}
          </li>
          <li>Hotel: {humanShortDate(hotelDate) || '—'}</li>
          <li>
            <button
              type="button"
              className="fdn-dualpms__link"
              onClick={() => {
                clearHkSelection()
                setShowAvailability(true)
              }}
            >
              Availability
            </button>
          </li>
          <li className={showingSubset ? 'fdn-dualpms__subset' : ''}>
            {filteredCount}/{totalRooms}
          </li>
        </ul>
        <button
          type="button"
          className="fdn-btn fdn-btn--secondary fdn-btn--with-icon fdn-dualpms__refresh"
          disabled={syncing}
          title="Refresh PMS sync and board data"
          onClick={() => void runPmsSyncJob()}
        >
          <IconRefresh className={`fdn-btn__icon${syncing ? ' fdn-dualpms__spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {!syncing && syncFreshness.anyStale ? (
        <div className="fdn-dualpms__alert fdn-dualpms__alert--error" role="alert">
          <p className="fdn-dualpms__alert-title">
            PMS sync stale — data may be outdated ({PMS_STALE_SYNC_THRESHOLD_SEC}s threshold)
          </p>
          <ul className="fdn-dualpms__alert-list">
            {syncFreshness.issues.map((issue) => (
              <li key={issue.system}>
                <strong>{issue.system}:</strong> {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!syncing && syncFreshness.fallbackActive ? (
        <div className="fdn-dualpms__alert fdn-dualpms__alert--warn" role="status">
          <p className="fdn-dualpms__alert-title">Backup mode: API fallback active</p>
          {syncFreshness.warnings.length ? (
            <ul className="fdn-dualpms__alert-list">
              {syncFreshness.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {syncError ? (
        <div className="fdn-dualpms__alert fdn-dualpms__alert--warn">
          <strong>Sync:</strong> {syncError}
        </div>
      ) : null}

      {error ? (
        <div className="fdn-dualpms__alert fdn-dualpms__alert--error">{error}</div>
      ) : null}

      {totalRooms > 0 ? (
        <div className="fdn-dualpms__api-grid" role="status" aria-label="Per-API sync status">
          {[apiHealth.synxis, apiHealth.ezee].map((h) => (
            <div key={h.system} className={`fdn-dualpms__api-card ${apiHealthClass(h.status)}`}>
              <div className="fdn-dualpms__api-head">
                <strong>{h.system} API</strong>
                <span className="fdn-dualpms__api-badge">{h.status.toUpperCase()}</span>
                <span className="fdn-dualpms__api-source">via {h.sourceLabel}</span>
              </div>
              <p className="fdn-dualpms__api-metrics">
                {h.system === 'SynXis' ? 'S.OCC' : 'E.OCC'} {h.roomsWithOccupancy}/{h.inventoryRooms}
                {' · '}
                HK {h.roomsWithHk}/{h.inventoryRooms}
              </p>
              <p className="fdn-dualpms__api-detail">{h.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="fdn-dualpms__toolbar">
        <input
          type="search"
          className="fdn-input fdn-dualpms__search"
          placeholder="Search room, guest, type…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search Dual PMS board"
        />
        <button
          type="button"
          className={`fdn-dualpms__filter-toggle${filtersOpen ? ' fdn-dualpms__filter-toggle--open' : ''}`}
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
        >
          Filters{columnFiltersActive ? ' •' : ''}
        </button>
      </div>

      {filtersOpen ? (
        <div className="fdn-dualpms__filters">
          <div className="fdn-dualpms__filter-row">
            <span className="fdn-dualpms__filter-label">Quick</span>
            <div className="fdn-dualpms__chips fdn-dualpms__chips--quick">
              <button type="button" className="fdn-dualpms__chip fdn-dualpms__chip--quick" onClick={applyVacantCleanPreset}>
                Vacant clean
              </button>
              <button type="button" className="fdn-dualpms__chip fdn-dualpms__chip--quick" onClick={applyVacantPreset}>
                Vacant
              </button>
              <button
                type="button"
                className="fdn-dualpms__chip fdn-dualpms__chip--quick"
                onClick={() => {
                  setFilter(defaultFilter())
                  setSearchQuery('')
                }}
              >
                Reset
              </button>
            </div>
          </div>

          <div className="fdn-dualpms__filter-row">
            <span className="fdn-dualpms__filter-label">Type</span>
            <div className="fdn-dualpms__chips">
              {ROOM_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`fdn-dualpms__chip${filter.room_types.includes(t) ? ' fdn-dualpms__chip--on' : ''}`}
                  onClick={() =>
                    setFilter((f) => ({ ...f, room_types: toggleInList(f.room_types, t) }))
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="fdn-dualpms__filter-row">
            <span className="fdn-dualpms__filter-label">HK</span>
            <div className="fdn-dualpms__chips">
              {(['Clean', 'Dirty'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`fdn-dualpms__chip${filter.synxis_hk.includes(v) ? ' fdn-dualpms__chip--on' : ''}`}
                  onClick={() =>
                    setFilter((f) => ({ ...f, synxis_hk: toggleInList(f.synxis_hk, v) }))
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="fdn-dualpms__filter-row">
            <span className="fdn-dualpms__filter-label">S.Occ</span>
            <div className="fdn-dualpms__chips">
              {(
                [
                  ['Vacant', 'Vacant'],
                  ['Occupied', 'Occ'],
                  ['Reserved', 'Arr'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={`fdn-dualpms__chip${filter.synxis_occ.includes(val) ? ' fdn-dualpms__chip--on' : ''}`}
                  onClick={() =>
                    setFilter((f) => ({ ...f, synxis_occ: toggleInList(f.synxis_occ, val) }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="fdn-dualpms__filter-row">
            <span className="fdn-dualpms__filter-label">E.Occ</span>
            <div className="fdn-dualpms__chips">
              {(['Vacant', 'Occupied', 'Blocked'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`fdn-dualpms__chip${filter.ezee_occ.includes(v) ? ' fdn-dualpms__chip--on' : ''}`}
                  onClick={() =>
                    setFilter((f) => ({ ...f, ezee_occ: toggleInList(f.ezee_occ, v) }))
                  }
                >
                  {v === 'Occupied' ? 'Occ' : v === 'Blocked' ? 'Blk' : v}
                </button>
              ))}
            </div>
          </div>

          <div className="fdn-dualpms__filter-row">
            <span className="fdn-dualpms__filter-label">OOO</span>
            <div className="fdn-dualpms__chips">
              <button
                type="button"
                className={`fdn-dualpms__chip${filter.synxis_ooo.includes('functional') ? ' fdn-dualpms__chip--on' : ''}`}
                onClick={() =>
                  setFilter((f) => ({ ...f, synxis_ooo: toggleInList(f.synxis_ooo, 'functional') }))
                }
              >
                OK
              </button>
              <button
                type="button"
                className={`fdn-dualpms__chip${filter.synxis_ooo.includes('ooo') ? ' fdn-dualpms__chip--on' : ''}`}
                onClick={() =>
                  setFilter((f) => ({ ...f, synxis_ooo: toggleInList(f.synxis_ooo, 'ooo') }))
                }
              >
                OOO
              </button>
            </div>
          </div>

        </div>
      ) : null}

      {hkMessage ? <p className="fdn-dualpms__hk-success">{hkMessage}</p> : null}

      {selectedRooms.length > 0 ? (
        <div className="fdn-dualpms__hk-selection-bar">
          <span>
            {selectedRooms.length} room{selectedRooms.length === 1 ? '' : 's'} selected
          </span>
          <button type="button" className="fdn-btn fdn-btn--primary" onClick={() => setHkDialogOpen(true)}>
            Mark clean / dirty
          </button>
          <button type="button" className="fdn-btn fdn-btn--secondary" onClick={clearHkSelection}>
            Clear
          </button>
        </div>
      ) : null}

      <div className="fdn-dualpms__table-wrap">
        <table className="fdn-dualpms__table">
          <thead>
            <tr>
              <th className="fdn-dualpms__th fdn-dualpms__th--sel">
                <input
                  type="checkbox"
                  aria-label="Select all visible rooms"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected
                  }}
                  onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                />
              </th>
              {(
                [
                  ['room_number', 'Rm'],
                  ['room_type', 'Type'],
                  ['synxis_hk_status', 'HK'],
                  ['synxis_ooo_code', 'OOO'],
                  ['synxis_occupancy', 'S.Occ'],
                  ['ezee_occupancy', 'E.Occ'],
                  ['merged_guest_name', 'Guest'],
                  ['merged_check_in_date', 'CI'],
                  ['merged_check_out_date', 'CO'],
                  ['folio', 'Bal'],
                ] as const
              ).map(([key, label]) => (
                <th
                  key={key}
                  className={sortBy === key ? 'fdn-dualpms__th fdn-dualpms__th--sorted' : 'fdn-dualpms__th'}
                  onClick={() => toggleSort(key)}
                >
                  {label}
                  {sortBy === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="fdn-dualpms__empty">
                  Loading…
                </td>
              </tr>
            ) : !inventoryConfigured ? (
              <tr>
                <td colSpan={11} className="fdn-dualpms__empty">
                  No rooms in inventory.
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={11} className="fdn-dualpms__empty">
                  {hasActiveSearch ? 'No rooms match search.' : 'No rooms match filters.'}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr
                  key={row.room_number}
                  className={`${PMS_ROW_TINT_CLASS[row.color]}${
                    selectedRooms.includes(row.room_number) ? ' fdn-dualpms__tr--selected' : ''
                  }`}
                >
                  <td className="fdn-dualpms__td fdn-dualpms__td--sel">
                    <input
                      type="checkbox"
                      aria-label={`Select room ${row.room_number}`}
                      checked={selectedRooms.includes(row.room_number)}
                      onChange={(e) => toggleRoomSelection(row.room_number, e.target.checked)}
                    />
                  </td>
                  <td className="fdn-dualpms__td fdn-dualpms__td--rm">{row.room_number}</td>
                  <td className="fdn-dualpms__td">{row.room_type ?? '—'}</td>
                  <td className="fdn-dualpms__td">
                    {row.synxis_hk_status ? (
                      <StatusBadge
                        label={row.synxis_hk_status}
                        badgeClass={hkStatusBadgeClass(row.synxis_hk_status)}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="fdn-dualpms__td">
                    {row.synxis_ooo_code && row.synxis_ooo_code !== '~' ? row.synxis_ooo_code : ''}
                  </td>
                  <td className="fdn-dualpms__td">
                    <StatusBadge
                      label={processSynxisOccupancy(row.synxis_occupancy)}
                      badgeClass={synxisOccBadgeClass(row.synxis_occupancy)}
                    />
                  </td>
                  <td className="fdn-dualpms__td">
                    <StatusBadge
                      label={stripEzeeSortKey(row.ezee_occupancy)}
                      badgeClass={ezeeOccBadgeClass(row.ezee_occupancy)}
                    />
                  </td>
                  <td className={`fdn-dualpms__td fdn-dualpms__td--guest ${guestNameClass(row.sold_by)}`}>
                    {row.merged_guest_name ?? ''}
                  </td>
                  <td className="fdn-dualpms__td">{humanShortDate(row.merged_check_in_date)}</td>
                  <td className="fdn-dualpms__td">{humanShortDate(row.merged_check_out_date)}</td>
                  <td className="fdn-dualpms__td fdn-dualpms__td--bal">
                    {row.folio != null ? row.folio.toFixed(2) : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PmsHousekeepingDialog
        open={hkDialogOpen}
        selectedCount={selectedRooms.length}
        requestStatus={hkRequestStatus}
        busy={hkBusy}
        error={hkError}
        onRequestStatusChange={setHkRequestStatus}
        onClose={closeHkDialog}
        onSend={() => void sendHousekeepingRequest()}
      />

      {showAvailability ? (
        <div className="fdn-dualpms__modal-backdrop" role="dialog" aria-modal="true">
          <div className="fdn-dualpms__modal">
            <div className="fdn-dualpms__modal-header">
              <h3 className="fdn-h2">Availability</h3>
              <button type="button" className="fdn-btn fdn-btn--secondary" onClick={() => setShowAvailability(false)}>
                Close
              </button>
            </div>
            <table className="fdn-dualpms__avail-table">
              <thead>
                <tr>
                  <th />
                  {ROOM_TYPES.map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {availabilityCounters.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    {ROOM_TYPES.map((t) => (
                      <td key={t}>{row.values[t] ?? 0}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  )
}
