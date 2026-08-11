/** DualPMS / SynXis room type codes synced via room_operational_status. */
export const ROOM_TYPES = ['NDD1', 'NK1', 'PND2', 'PNK1', 'SNK4'] as const

export type RoomTypeCode = (typeof ROOM_TYPES)[number]

/** Clerk-facing labels (bed type). */
export const ROOM_TYPE_LABELS: Record<RoomTypeCode, string> = {
  NDD1: 'NDD1 — 2 beds',
  NK1: 'NK1 — King',
  PND2: 'PND2 — Double beds',
  PNK1: 'PNK1 — King',
  SNK4: 'SNK4 — King suite',
}

/** Common aliases staff may type or say aloud. */
const ROOM_TYPE_ALIASES: Record<string, RoomTypeCode> = {
  PND1: 'PND2',
  SNK1: 'SNK4',
}

export function normalizeRoomTypeCode(value: string | null | undefined): RoomTypeCode | null {
  const raw = value?.trim().toUpperCase()
  if (!raw) return null
  const aliased = (ROOM_TYPE_ALIASES[raw] ?? raw) as RoomTypeCode
  return (ROOM_TYPES as readonly string[]).includes(aliased) ? aliased : null
}

export function roomTypesMatch(requested: string, actual: string | null | undefined): boolean {
  const want = normalizeRoomTypeCode(requested)
  const have = normalizeRoomTypeCode(actual)
  if (!want || !have) return false
  return want === have
}
