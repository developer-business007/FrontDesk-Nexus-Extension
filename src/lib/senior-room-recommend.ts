import type { KeyBoardEntry } from '../shared/protocol'
import { isDualPmsAssignable, type PmsOperationalRoomRow } from './pms-room-status'
import { processSynxisOccupancy, stripEzeeOccupancyLabel } from './pms-room-status'
import { normalizeRoomTypeCode, roomTypesMatch } from './room-types'
import { parseHotelRoomList, sortRoomNumbers } from './room-inventory'
import {
  getDefaultPropertyLayout,
  pickClosestRoomCluster,
  type PropertyLayout,
  type RoomClusterPick,
} from './property-layout'
import { roomFloorFromNumber } from './senior-room-floor'

export { roomFloorFromNumber } from './senior-room-floor'

/** Stayovers + arrivals — when ≥ threshold, non-senior guests prefer upper floors. */
export const BUSY_HOTEL_THRESHOLD = 20

/** Hotel settings subset used for senior room recommendations. */
export type SeniorRecommendSettings = {
  seniorRecommendEnabled: boolean
  seniorRecommendAge: number
  seniorPreferredFloors: number[]
  seniorPreferredRoomList: string
}

export const DEFAULT_SENIOR_RECOMMEND_SETTINGS: SeniorRecommendSettings = {
  seniorRecommendEnabled: true,
  seniorRecommendAge: 50,
  seniorPreferredFloors: [1],
  seniorPreferredRoomList: '',
}

export type SeniorRoomClusterQuality = 'adjacent' | 'nearby' | 'split' | 'none'

export type SeniorRoomRecommendation = {
  roomNumber: string
  floor: number | null
  roomType: string | null
}

export type SeniorRoomTypeRequest = {
  roomType: string
  count: number
}

export type SeniorRoomRecommendGroup = {
  roomType: string
  count: number
  rooms: SeniorRoomRecommendation[]
}

export type SeniorRecommendContext = {
  /** Defaults to true — senior ID-scan flow. */
  isSeniorGuest?: boolean
  /** Stayovers + today's arrivals; computed from PMS when omitted. */
  busyCount?: number
}

export type SeniorRoomRecommendResult = {
  recommended: SeniorRoomRecommendation[]
  groups: SeniorRoomRecommendGroup[]
  floor: number | null
  sameFloorCluster: boolean
  clusterQuality: SeniorRoomClusterQuality
  notes: string[]
  needsGuestConfirmation: boolean
  fallback: SeniorRoomRecommendation[]
  usedCustomList: boolean
  preferredFloors: number[]
  busyCount: number
  propertyLayoutId: string | null
}

const RECOMMENDED_LIMIT = 8
const FALLBACK_LIMIT = 4
const MAX_ROOMS_PER_REQUEST = 3
const MAX_TYPE_LINES = 3

export function parseSeniorPreferredFloors(value: unknown): number[] {
  if (Array.isArray(value)) {
    const floors = value
      .map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN))
      .filter((n) => Number.isFinite(n) && n >= 0)
    if (floors.length > 0) return [...new Set(floors)].sort((a, b) => a - b)
  }
  if (typeof value === 'string' && value.trim()) {
    const floors = value
      .split(/[\s,;]+/)
      .map((p) => parseInt(p.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0)
    if (floors.length > 0) return [...new Set(floors)].sort((a, b) => a - b)
  }
  return DEFAULT_SENIOR_RECOMMEND_SETTINGS.seniorPreferredFloors
}

function seniorPreferredRoomSet(settings: SeniorRecommendSettings): Set<string> | null {
  const list = parseHotelRoomList(settings.seniorPreferredRoomList)
  if (list.length === 0) return null
  return new Set(list)
}

export function isSeniorPreferredRoom(roomNumber: string, settings: SeniorRecommendSettings): boolean {
  const custom = seniorPreferredRoomSet(settings)
  if (custom) return custom.has(roomNumber.trim())
  const floor = roomFloorFromNumber(roomNumber)
  if (floor === null) return false
  return settings.seniorPreferredFloors.includes(floor)
}

/** Count in-house stayovers plus arriving reservations (busy-day signal). */
export function countBusyHotelRooms(rows: PmsOperationalRoomRow[]): number {
  let count = 0
  for (const row of rows) {
    const sOcc = processSynxisOccupancy(row.synxisOccupancy)
    const eOcc = stripEzeeOccupancyLabel(row.ezeeOccupancy)
    if (sOcc === 'Occupied' || row.synxisOccupancy === 'Occupied' || eOcc === 'Occupied') {
      count += 1
      continue
    }
    if (sOcc === 'Arriving' || row.synxisOccupancy === 'Reserved') count += 1
  }
  return count
}

function toRecommendation(roomNumber: string, roomType: string | null): SeniorRoomRecommendation {
  return { roomNumber, floor: roomFloorFromNumber(roomNumber), roomType }
}

function roomNumeric(roomNumber: string): number {
  const n = parseInt(roomNumber, 10)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

/** Legacy numeric spread — fallback when no property layout applies. */
export function pickClosestRoomNumbers(roomNumbers: string[], count: number): string[] | null {
  if (count < 1 || roomNumbers.length < count) return null
  const sorted = sortRoomNumbers(roomNumbers)
  if (count === 1) return [sorted[0]!]

  let best: string[] | null = null
  let bestSpread = Number.POSITIVE_INFINITY
  for (let i = 0; i <= sorted.length - count; i++) {
    const window = sorted.slice(i, i + count)
    const spread = roomNumeric(window[window.length - 1]!) - roomNumeric(window[0]!)
    if (spread < bestSpread) {
      bestSpread = spread
      best = window
    }
  }
  return best
}

function pickClosestRooms(
  layout: PropertyLayout | null,
  floor: number,
  roomNumbers: string[],
  count: number,
  preferElevator: boolean,
): RoomClusterPick | null {
  if (layout?.graphsByFloor.has(floor)) {
    const hubs = preferElevator ? layout.elevatorHubs(floor) : []
    const graph = layout.graphsByFloor.get(floor)!
    const onFloor = roomNumbers.filter((r) => roomFloorFromNumber(r) === floor)
    return pickClosestRoomCluster(graph, onFloor, count, hubs)
  }
  const picked = pickClosestRoomNumbers(roomNumbers, count)
  if (!picked) return null
  const maxDistance =
    picked.length > 1
      ? roomNumeric(picked[picked.length - 1]!) - roomNumeric(picked[0]!)
      : 0
  return {
    rooms: picked,
    maxDistance,
    quality: maxDistance <= 1 ? 'adjacent' : maxDistance <= 6 ? 'nearby' : 'split',
  }
}

function sanitizeRoomRequests(requests: SeniorRoomTypeRequest[] | undefined): SeniorRoomTypeRequest[] {
  if (!requests?.length) return [{ roomType: 'NK1', count: 1 }]
  const out: SeniorRoomTypeRequest[] = []
  for (const row of requests.slice(0, MAX_TYPE_LINES)) {
    const roomType = normalizeRoomTypeCode(row.roomType)
    if (!roomType) continue
    const count = Math.max(1, Math.min(MAX_ROOMS_PER_REQUEST, Math.floor(row.count) || 1))
    out.push({ roomType, count })
  }
  return out.length > 0 ? out : [{ roomType: 'NK1', count: 1 }]
}

type Candidate = PmsOperationalRoomRow & { floor: number | null }

function toCandidates(rows: PmsOperationalRoomRow[]): Candidate[] {
  return rows
    .filter((r) => isDualPmsAssignable(r))
    .map((r) => ({
      ...r,
      floor: roomFloorFromNumber(r.roomNumber),
    }))
}

function candidatesByType(candidates: Candidate[], roomType: string): Candidate[] {
  return candidates.filter((c) => roomTypesMatch(roomType, c.roomType))
}

function qualityRank(q: SeniorRoomClusterQuality): number {
  if (q === 'adjacent') return 0
  if (q === 'nearby') return 1
  if (q === 'split') return 2
  return 3
}

function worstQuality(a: SeniorRoomClusterQuality, b: SeniorRoomClusterQuality): SeniorRoomClusterQuality {
  return qualityRank(a) >= qualityRank(b) ? a : b
}

function floorsToTry(
  settings: SeniorRecommendSettings,
  candidates: Candidate[],
  context: SeniorRecommendContext,
): number[] {
  const custom = seniorPreferredRoomSet(settings)
  const available = new Set<number>()
  for (const c of candidates) {
    if (c.floor !== null) available.add(c.floor)
  }

  if (custom) {
    return [...available].sort((a, b) => a - b)
  }

  const isSenior = context.isSeniorGuest !== false
  const busy = context.busyCount ?? 0
  const busyDay = busy >= BUSY_HOTEL_THRESHOLD

  let priority: number[]
  if (isSenior) {
    priority = [1, 2, 3]
  } else if (busyDay) {
    priority = [2, 3, 1]
  } else {
    priority = [1, 2, 3]
  }

  const preferred = settings.seniorPreferredFloors
  const ordered = [
    ...priority.filter((f) => preferred.includes(f)),
    ...priority.filter((f) => !preferred.includes(f)),
  ]
  const unique = [...new Set(ordered)]
  const rest = [...available].filter((f) => !unique.includes(f)).sort((a, b) => a - b)
  return [...unique, ...rest].filter((f) => available.has(f))
}

type GroupPick = {
  roomType: string
  count: number
  rooms: SeniorRoomRecommendation[]
  quality: SeniorRoomClusterQuality
  maxDistance: number
}

type FloorPlan = {
  floor: number
  groups: SeniorRoomRecommendGroup[]
  clusterQuality: SeniorRoomClusterQuality
  maxDistance: number
}

function buildFloorPlan(
  floor: number,
  requests: SeniorRoomTypeRequest[],
  candidates: Candidate[],
  layout: PropertyLayout | null,
  preferElevator: boolean,
): FloorPlan | null {
  const groupPicks: GroupPick[] = []

  for (const req of requests) {
    const pool = candidatesByType(candidates, req.roomType).filter((c) => c.floor === floor)
    const picked = pickClosestRooms(
      layout,
      floor,
      pool.map((c) => c.roomNumber),
      req.count,
      preferElevator,
    )
    if (!picked || picked.rooms.length < req.count) return null
    groupPicks.push({
      roomType: req.roomType,
      count: req.count,
      rooms: picked.rooms.map((roomNumber) => {
        const row = pool.find((p) => p.roomNumber === roomNumber)
        return toRecommendation(roomNumber, row?.roomType ?? req.roomType)
      }),
      quality: picked.quality,
      maxDistance: picked.maxDistance,
    })
  }

  let clusterQuality: SeniorRoomClusterQuality = 'adjacent'
  let maxDistance = 0
  for (const g of groupPicks) {
    clusterQuality = worstQuality(clusterQuality, g.quality)
    if (g.maxDistance > maxDistance) maxDistance = g.maxDistance
  }

  return {
    floor,
    groups: groupPicks.map(({ roomType, count, rooms }) => ({ roomType, count, rooms })),
    clusterQuality,
    maxDistance,
  }
}

function recommendPerTypeIndependently(
  requests: SeniorRoomTypeRequest[],
  candidates: Candidate[],
  floors: number[],
  layout: PropertyLayout | null,
  preferElevator: boolean,
): { groups: SeniorRoomRecommendGroup[]; clusterQuality: SeniorRoomClusterQuality } {
  const groups: SeniorRoomRecommendGroup[] = []
  let clusterQuality: SeniorRoomClusterQuality = 'none'

  for (const req of requests) {
    const pool = candidatesByType(candidates, req.roomType)
    let picked: RoomClusterPick | null = null
    for (const floor of floors) {
      const onFloor = pool.filter((c) => c.floor === floor).map((c) => c.roomNumber)
      picked = pickClosestRooms(layout, floor, onFloor, req.count, preferElevator)
      if (picked) break
    }
    if (!picked) {
      picked = pickClosestRooms(
        layout,
        floors[0] ?? 1,
        pool.map((c) => c.roomNumber),
        req.count,
        preferElevator,
      )
    }
    const quality = picked?.quality ?? 'none'
    clusterQuality = worstQuality(clusterQuality, quality)
    groups.push({
      roomType: req.roomType,
      count: req.count,
      rooms: (picked?.rooms ?? []).map((roomNumber) => {
        const row = pool.find((p) => p.roomNumber === roomNumber)
        return toRecommendation(roomNumber, row?.roomType ?? req.roomType)
      }),
    })
  }
  return { groups, clusterQuality }
}

function buildRecommendationNotes(opts: {
  floor: number | null
  clusterQuality: SeniorRoomClusterQuality
  isSenior: boolean
  needsGuestConfirmation: boolean
  preferElevator: boolean
  busyCount: number
  totalRoomsNeeded: number
}): string[] {
  const notes: string[] = []
  const { floor, clusterQuality, isSenior, needsGuestConfirmation, preferElevator, busyCount, totalRoomsNeeded } =
    opts

  if (totalRoomsNeeded > 1) {
    if (clusterQuality === 'adjacent') {
      notes.push('Rooms are adjoining on the same hallway side (even–even or odd–odd).')
    } else if (clusterQuality === 'nearby') {
      notes.push('Rooms are nearby on the property map (not directly adjoining).')
    } else if (clusterQuality === 'split') {
      notes.push('Rooms are on the same floor but farther apart — confirm with guest.')
    }
  }

  if (isSenior && floor === 2) {
    notes.push('1st floor unavailable — using 2nd floor.')
  }
  if (isSenior && floor === 3) {
    notes.push('1st and 2nd floors unavailable — 3rd floor is a last resort; confirm with guest.')
  }
  if (preferElevator && floor !== null && floor > 1) {
    notes.push('Picked near an elevator for easier access.')
  }
  if (needsGuestConfirmation) {
    notes.push('Cannot place rooms together on 1st or 2nd floor — ask guest if upper floor is OK.')
  }
  if (!isSenior && busyCount >= BUSY_HOTEL_THRESHOLD && floor !== null && floor > 1) {
    notes.push(`Busy day (${busyCount} in-house/arriving) — upper floor preserves 1st for seniors.`)
  }

  return notes
}

/**
 * Senior-friendly vacant rooms from DualPMS `room_operational_status`.
 * Uses property corridor graph (A/B/C wings) for true adjacency — not numeric room order.
 */
export function recommendSeniorRoomsFromPms(
  pmsRows: PmsOperationalRoomRow[],
  settings: SeniorRecommendSettings,
  requests?: SeniorRoomTypeRequest[],
  context: SeniorRecommendContext = {},
): SeniorRoomRecommendResult {
  const usedCustomList = seniorPreferredRoomSet(settings) !== null
  const preferredFloors = settings.seniorPreferredFloors
  const sanitized = sanitizeRoomRequests(requests)
  const isSenior = context.isSeniorGuest !== false
  const busyCount = context.busyCount ?? countBusyHotelRooms(pmsRows)
  const layout = getDefaultPropertyLayout()
  const totalRoomsNeeded = sanitized.reduce((sum, r) => sum + r.count, 0)

  const allAssignable = toCandidates(pmsRows)
  let candidates = allAssignable

  if (usedCustomList) {
    const custom = seniorPreferredRoomSet(settings)!
    candidates = allAssignable.filter((r) => custom.has(r.roomNumber.trim()))
  }

  const floors = floorsToTry(settings, candidates, { ...context, busyCount })

  let bestPlan: FloorPlan | null = null
  for (const floor of floors) {
    const preferElevator = isSenior && floor > 1
    const plan = buildFloorPlan(floor, sanitized, candidates, layout, preferElevator)
    if (!plan) continue
    if (!bestPlan) {
      bestPlan = plan
      continue
    }
    const floorRank = floors.indexOf(floor)
    const bestRank = floors.indexOf(bestPlan.floor)
    if (floorRank < bestRank) {
      bestPlan = plan
      continue
    }
    if (floorRank > bestRank) continue
    if (qualityRank(plan.clusterQuality) < qualityRank(bestPlan.clusterQuality)) {
      bestPlan = plan
      continue
    }
    if (plan.maxDistance < bestPlan.maxDistance) bestPlan = plan
  }

  let groups: SeniorRoomRecommendGroup[]
  let floor: number | null = null
  let sameFloorCluster = false
  let clusterQuality: SeniorRoomClusterQuality = 'none'

  if (bestPlan && bestPlan.groups.every((g) => g.rooms.length >= g.count)) {
    groups = bestPlan.groups
    floor = bestPlan.floor
    clusterQuality = bestPlan.clusterQuality
    sameFloorCluster = sanitized.length > 1 || totalRoomsNeeded > 1
  } else {
    const preferElevator = isSenior
    const split = recommendPerTypeIndependently(sanitized, candidates, floors, layout, preferElevator)
    groups = split.groups
    clusterQuality = split.clusterQuality
    const floorsUsed = new Set(
      groups.flatMap((g) => g.rooms.map((r) => r.floor).filter((f): f is number => f !== null)),
    )
    sameFloorCluster = floorsUsed.size === 1 && floorsUsed.size > 0
    floor = sameFloorCluster ? [...floorsUsed][0]! : null
  }

  const needsGuestConfirmation =
    isSenior &&
    totalRoomsNeeded > 1 &&
    ((floor !== null && floor >= 3) ||
      (clusterQuality === 'split' && floor !== null && floor <= 2) ||
      !sameFloorCluster)

  const notes = buildRecommendationNotes({
    floor,
    clusterQuality,
    isSenior,
    needsGuestConfirmation,
    preferElevator: isSenior && floor !== null && floor > 1,
    busyCount,
    totalRoomsNeeded,
  })

  const recommended = groups.flatMap((g) => g.rooms).slice(0, RECOMMENDED_LIMIT)

  let fallback: SeniorRoomRecommendation[] = []
  if (recommended.length === 0) {
    const preferredSet = new Set(recommended.map((r) => r.roomNumber))
    fallback = sortRoomNumbers(
      candidates.map((c) => c.roomNumber).filter((r) => !preferredSet.has(r)),
    )
      .slice(0, FALLBACK_LIMIT)
      .map((roomNumber) => {
        const row = candidates.find((c) => c.roomNumber === roomNumber)
        return toRecommendation(roomNumber, row?.roomType ?? null)
      })
  }

  return {
    recommended,
    groups,
    floor,
    sameFloorCluster,
    clusterQuality,
    notes,
    needsGuestConfirmation,
    fallback,
    usedCustomList,
    preferredFloors,
    busyCount,
    propertyLayoutId: layout.id,
  }
}

/** @deprecated Use PMS-backed recommendations. */
export function recommendSeniorRoomsFromBoard(
  board: KeyBoardEntry[],
  settings: SeniorRecommendSettings,
): SeniorRoomRecommendResult {
  const pmsRows: PmsOperationalRoomRow[] = board.map((e) => ({
    roomNumber: e.roomNumber,
    roomType: null,
    synxisHkStatus: e.roomStatus === 'available' ? 'Clean' : null,
    synxisOccupancy: e.hasKey ? 'Occupied' : 'Vacant',
    synxisOooCode: null,
    ezeeOccupancy: e.hasKey ? 'Occupied' : 'Vacant',
    blocked: e.blocked,
  }))
  return recommendSeniorRoomsFromPms(pmsRows, settings)
}

export function guestQualifiesForSeniorRecommend(
  ageYears: number | null,
  settings: SeniorRecommendSettings,
): boolean {
  if (!settings.seniorRecommendEnabled) return false
  if (settings.seniorRecommendAge <= 0) return false
  if (ageYears === null) return false
  return ageYears >= settings.seniorRecommendAge
}

export function clampSeniorRecommendAge(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return DEFAULT_SENIOR_RECOMMEND_SETTINGS.seniorRecommendAge
  }
  return Math.max(0, Math.min(99, Math.floor(n)))
}

export function sanitizeSeniorRoomList(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, 2000)
}
