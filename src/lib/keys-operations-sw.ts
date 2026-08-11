import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  KeyBoardEntry,
  KeyLedgerEntry,
  RoomBlockEntry,
} from '../shared/protocol'
import { insertAuditRow } from './audit-log'
import { localDateRangeToUtcIso } from './local-date'
import {
  boardGuestDisplay,
  keyHistoryAgent,
  keyHistoryCheckin,
  keyHistoryCheckout,
  keyHistoryEventTime,
  keyHistoryGuestName,
  keyHistoryVisibleOnBusinessDate,
  occupancyByRoomForDate,
  reservationGuestMaps,
  type KeyBoardHistoryRow,
  type ReservationGuestPick,
} from './key-board'
import {
  countBusyHotelRooms,
  recommendSeniorRoomsFromPms,
  type SeniorRecommendSettings,
  type SeniorRoomRecommendResult,
  type SeniorRoomTypeRequest,
} from './senior-room-recommend'
import { type PmsOperationalRoomRow } from './pms-room-status'
export type RoomBlockRow = {
  id: string
  room_number: string
  blocked_until: string | null
  reason: string | null
  created_at: string
  released_at: string | null
  effective_from_vacancy?: boolean | null
}

export function isActiveRoomBlock(block: RoomBlockRow, now = new Date()): boolean {
  if (block.released_at) return false
  if (!block.blocked_until) return true
  return new Date(block.blocked_until).getTime() > now.getTime()
}

export function keysWriteAuthorized(
  role: string | null,
  managerPin: string | undefined,
  configuredManagerPin: string,
): boolean {
  if (role === 'admin') return true
  const pin = managerPin?.trim()
  if (!pin || !configuredManagerPin) return false
  return pin === configuredManagerPin
}

export async function fetchKeyBoardData(
  client: SupabaseClient,
  businessDate: string,
  agentFilter?: string,
): Promise<{ board: KeyBoardEntry[]; stats: { total: number; withKey: number; vacant: number } }> {
  const { data: roomRows, error: roomErr } = await client
    .from('rooms')
    .select('room_number')
    .eq('is_active', true)
    .order('room_number')
  if (roomErr) throw new Error(roomErr.message)

  const rooms = (roomRows ?? []).map((r) => String((r as { room_number: string }).room_number))

  let keyQuery = client.from('key_history').select('*').order('created_at', { ascending: false })
  const { data: keyData, error: keyErr } = await keyQuery
  if (keyErr) throw new Error(keyErr.message)

  let keys = (keyData ?? []) as KeyBoardHistoryRow[]
  if (agentFilter?.trim()) {
    const term = agentFilter.trim().toLowerCase()
    keys = keys.filter((k) => (keyHistoryAgent(k) ?? '').toLowerCase().includes(term))
  }

  const confs = new Set<string>()
  for (const k of keys) {
    if (!keyHistoryVisibleOnBusinessDate(k, businessDate)) continue
    const c = k.confirmation_number?.trim()
    if (c) confs.add(c)
  }

  let resGuests = new Map<string, string>()
  let checkedOut = new Set<string>()
  let roomByConfirmation = new Map<string, string>()

  if (confs.size > 0) {
    const { data: resRows, error: resErr } = await client
      .from('reservations')
      .select('confirmation_number, guest_name, reservation_status, updated_at, room_number')
      .in('confirmation_number', [...confs])
    if (resErr) throw new Error(resErr.message)
    const maps = reservationGuestMaps((resRows ?? []) as ReservationGuestPick[])
    resGuests = maps.guests
    checkedOut = maps.checkedOut
    roomByConfirmation = maps.roomByConfirmation
  }

  const byRoom = occupancyByRoomForDate(keys, businessDate, checkedOut, roomByConfirmation)

  const { data: blockRows } = await client
    .from('room_blocks')
    .select('*')
    .is('released_at', null)

  const blocksByRoom = new Map<string, RoomBlockRow>()
  const now = new Date()
  for (const b of (blockRows ?? []) as RoomBlockRow[]) {
    if (!isActiveRoomBlock(b, now)) continue
    const cur = blocksByRoom.get(b.room_number)
    if (!cur || new Date(b.created_at).getTime() > new Date(cur.created_at).getTime()) {
      blocksByRoom.set(b.room_number, b)
    }
  }

  const { data: hkRows } = await client.from('room_operational_status').select('room_number, status')
  const hkByRoom = new Map<string, string>()
  for (const r of hkRows ?? []) {
    const rn = String((r as { room_number: string }).room_number)
    hkByRoom.set(rn, String((r as { status: string }).status))
  }

  const board: KeyBoardEntry[] = rooms.map((room) => {
    const key = byRoom.get(room) ?? null
    const block = blocksByRoom.get(room)
    return {
      roomNumber: room,
      guestName: key ? boardGuestDisplay(key, resGuests) : null,
      confirmationNumber: key?.confirmation_number?.trim() || null,
      checkinTime: key ? keyHistoryCheckin(key) : null,
      checkoutTime: key ? keyHistoryCheckout(key) : null,
      encodedBy: key ? keyHistoryAgent(key) : null,
      cardSerial: key?.card_serial ?? null,
      blocked: Boolean(block),
      blockSummary: block
        ? block.blocked_until
          ? `Blocked until ${new Date(block.blocked_until).toLocaleString()}`
          : 'Blocked indefinitely'
        : null,
      blockId: block?.id ?? null,
      deferredBlock: Boolean(block?.effective_from_vacancy),
      roomStatus: hkByRoom.get(room) ?? null,
      hasKey: Boolean(key),
    }
  })

  const withKey = board.filter((r) => r.hasKey).length
  return {
    board,
    stats: { total: board.length, withKey, vacant: board.length - withKey },
  }
}

export async function fetchPmsOperationalRooms(
  client: SupabaseClient,
): Promise<PmsOperationalRoomRow[]> {
  const { data: roomRows, error: roomErr } = await client
    .from('rooms')
    .select('room_number')
    .eq('is_active', true)
    .order('room_number')
  if (roomErr) throw new Error(roomErr.message)

  const inventory = (roomRows ?? []).map((r) => String((r as { room_number: string }).room_number))
  if (inventory.length === 0) return []

  const { data: pmsRows, error: pmsErr } = await client
    .from('room_operational_status')
    .select(
      'room_number, room_type, synxis_hk_status, synxis_occupancy, synxis_ooo_code, ezee_occupancy',
    )
    .in('room_number', inventory)
  if (pmsErr) throw new Error(pmsErr.message)

  const pmsByRoom = new Map<string, Record<string, unknown>>()
  for (const row of pmsRows ?? []) {
    const rn = String((row as { room_number: string }).room_number).trim()
    if (rn) pmsByRoom.set(rn, row as Record<string, unknown>)
  }

  const { data: blockRows } = await client
    .from('room_blocks')
    .select('*')
    .is('released_at', null)

  const blocksByRoom = new Map<string, RoomBlockRow>()
  const now = new Date()
  for (const b of (blockRows ?? []) as RoomBlockRow[]) {
    if (!isActiveRoomBlock(b, now)) continue
    const cur = blocksByRoom.get(b.room_number)
    if (!cur || new Date(b.created_at).getTime() > new Date(cur.created_at).getTime()) {
      blocksByRoom.set(b.room_number, b)
    }
  }

  return inventory.map((roomNumber) => {
    const pms = pmsByRoom.get(roomNumber)
    return {
      roomNumber,
      roomType: typeof pms?.room_type === 'string' ? pms.room_type : null,
      synxisHkStatus:
        typeof pms?.synxis_hk_status === 'string' ? pms.synxis_hk_status : null,
      synxisOccupancy:
        typeof pms?.synxis_occupancy === 'string' ? pms.synxis_occupancy : null,
      synxisOooCode: typeof pms?.synxis_ooo_code === 'string' ? pms.synxis_ooo_code : null,
      ezeeOccupancy: typeof pms?.ezee_occupancy === 'string' ? pms.ezee_occupancy : null,
      blocked: Boolean(blocksByRoom.get(roomNumber)),
    }
  })
}

export async function fetchSeniorRoomRecommendations(
  client: SupabaseClient,
  _businessDate: string,
  settings: SeniorRecommendSettings,
  roomRequests?: SeniorRoomTypeRequest[],
): Promise<SeniorRoomRecommendResult> {
  const pmsRows = await fetchPmsOperationalRooms(client)
  const busyCount = countBusyHotelRooms(pmsRows)
  return recommendSeniorRoomsFromPms(pmsRows, settings, roomRequests, {
    isSeniorGuest: true,
    busyCount,
  })
}

export async function fetchKeyLedger(
  client: SupabaseClient,
  fromDate: string,
  toDate: string,
  agentFilter?: string,
  roomFilter?: string,
): Promise<KeyLedgerEntry[]> {
  const { startIso, endIso } = localDateRangeToUtcIso(fromDate, toDate)

  let q = client
    .from('key_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (fromDate.trim()) q = q.gte('created_at', startIso)
  if (toDate.trim()) q = q.lte('created_at', endIso)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  let rows = ((data ?? []) as KeyBoardHistoryRow[]).filter((r) => r.success !== false)

  if (agentFilter?.trim()) {
    const term = agentFilter.trim().toLowerCase()
    rows = rows.filter((r) => (keyHistoryAgent(r) ?? '').toLowerCase().includes(term))
  }
  if (roomFilter?.trim()) {
    const term = roomFilter.trim().toLowerCase()
    rows = rows.filter((r) => (r.room_number ?? '').toLowerCase().includes(term))
  }

  const confs = [...new Set(rows.map((r) => r.confirmation_number).filter(Boolean))]
  const guestByConf = new Map<string, string>()
  if (confs.length > 0) {
    const { data: resRows } = await client
      .from('reservations')
      .select('confirmation_number, guest_name')
      .in('confirmation_number', confs)
    for (const r of resRows ?? []) {
      const c = String((r as { confirmation_number: string }).confirmation_number)
      const g = (r as { guest_name: string | null }).guest_name
      if (g?.trim()) guestByConf.set(c, g.trim())
    }
  }

  return rows.map((r) => ({
    id: r.id,
    roomNumber: (r.room_number ?? '').trim() || '—',
    guestName:
      keyHistoryGuestName(r) ?? guestByConf.get(r.confirmation_number) ?? null,
    confirmationNumber: r.confirmation_number,
    cardSerial: r.card_serial ?? null,
    checkinTime: keyHistoryCheckin(r),
    checkoutTime: keyHistoryCheckout(r),
    encodedBy: keyHistoryAgent(r),
    encodedAt: keyHistoryEventTime(r) || r.created_at || '',
  }))
}

export async function createRoomBlockSw(
  client: SupabaseClient,
  params: {
    roomNumber: string
    blockedUntil: string | null
    reason: string | null
    userId: string
    username: string | null
    role: string | null
    effectiveFromVacancy: boolean
  },
): Promise<{ error: string | null }> {
  const { error } = await client
    .from('room_blocks')
    .insert({
      room_number: params.roomNumber.trim(),
      blocked_until: params.blockedUntil,
      reason: params.reason?.trim() || null,
      created_by: params.userId,
      effective_from_vacancy: params.effectiveFromVacancy,
    })
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }

  await insertAuditRow(client, {
    action_type: 'room_block_created',
    user_id: params.userId,
    username: params.username,
    user_role: params.role,
    description: `Room ${params.roomNumber} blocked from extension`,
    new_value: {
      room_number: params.roomNumber,
      blocked_until: params.blockedUntil,
      effective_from_vacancy: params.effectiveFromVacancy,
    },
  })

  return { error: null }
}

export async function releaseRoomBlockSw(
  client: SupabaseClient,
  params: {
    blockId: string
    roomNumber: string
    userId: string
    username: string | null
    role: string | null
  },
): Promise<{ error: string | null }> {
  const { error } = await client
    .from('room_blocks')
    .update({
      released_at: new Date().toISOString(),
      released_by: params.userId,
    })
    .eq('id', params.blockId)

  if (error) return { error: error.message }

  await insertAuditRow(client, {
    action_type: 'room_block_released',
    user_id: params.userId,
    username: params.username,
    user_role: params.role,
    description: `Room ${params.roomNumber} unblocked from extension`,
    new_value: { block_id: params.blockId },
  })

  return { error: null }
}

export function roomBlockToEntry(b: RoomBlockRow): RoomBlockEntry {
  return {
    id: b.id,
    roomNumber: b.room_number,
    blockedUntil: b.blocked_until,
    reason: b.reason,
    createdAt: b.created_at,
    effectiveFromVacancy: Boolean(b.effective_from_vacancy),
  }
}

export function isDeferredMaintenanceBlock(block: RoomBlockRow | null | undefined): boolean {
  return Boolean(block?.effective_from_vacancy)
}

export function isRoomAvailableForNewCheckIn(status: string | null | undefined): boolean {
  return status === 'available' || status == null
}

export function isRoomBlockBlockingEncode(
  block: RoomBlockRow | null | undefined,
  roomOccupantConfirmation: string | null,
  encodeConfirmation: string | null | undefined,
  now = new Date(),
): boolean {
  if (!block || !isActiveRoomBlock(block, now)) return false
  if (!isDeferredMaintenanceBlock(block)) return true
  const occ = roomOccupantConfirmation?.trim() || null
  if (!occ) return true
  const enc = encodeConfirmation?.trim() || ''
  return enc !== occ
}

function datePartFromDateTimeInput(v: string): string {
  const t = v.trim()
  if (!t) return ''
  if (t.includes('T')) return t.split('T')[0]!
  return t.slice(0, 10)
}

async function fetchActiveBlocksByRoom(
  client: SupabaseClient,
): Promise<Map<string, RoomBlockRow>> {
  const { data: blockRows } = await client
    .from('room_blocks')
    .select('*')
    .is('released_at', null)
  const blocksByRoom = new Map<string, RoomBlockRow>()
  const now = new Date()
  for (const b of (blockRows ?? []) as RoomBlockRow[]) {
    if (!isActiveRoomBlock(b, now)) continue
    const cur = blocksByRoom.get(b.room_number)
    if (!cur || new Date(b.created_at).getTime() > new Date(cur.created_at).getTime()) {
      blocksByRoom.set(b.room_number, b)
    }
  }
  return blocksByRoom
}

async function fetchRoomHkStatus(
  client: SupabaseClient,
  roomNumber: string,
): Promise<string | null> {
  const { data } = await client
    .from('room_operational_status')
    .select('status')
    .eq('room_number', roomNumber.trim())
    .maybeSingle()
  return data ? String((data as { status: string }).status) : null
}

async function roomHasBoardOccupant(
  client: SupabaseClient,
  roomNumber: string,
  businessDate: string,
): Promise<{ occupied: boolean; confirmation: string | null }> {
  const { board } = await fetchKeyBoardData(client, businessDate)
  const row = board.find((r) => r.roomNumber === roomNumber.trim())
  return {
    occupied: Boolean(row?.hasKey),
    confirmation: row?.confirmationNumber?.trim() || null,
  }
}

export type KeysBoardWriteContext = {
  userId: string
  username: string | null
  role: string | null
}

export async function keysAddGuestSw(
  client: SupabaseClient,
  params: {
    roomNumber: string
    guestName: string
    checkinTime: string
    checkoutTime: string
    phone?: string | null
    businessDate: string
  },
  ctx: KeysBoardWriteContext,
): Promise<{ error: string | null; confirmationNumber?: string }> {
  const room = params.roomNumber.trim()
  const guestName = params.guestName.trim()
  if (!room) return { error: 'Room is required.' }
  if (!guestName) return { error: 'Guest name is required.' }
  if (!params.checkinTime.trim() || !params.checkoutTime.trim()) {
    return { error: 'Check-in and check-out are required.' }
  }
  const checkoutAt = new Date(params.checkoutTime)
  if (Number.isNaN(checkoutAt.getTime()) || checkoutAt.getTime() <= Date.now()) {
    return { error: 'Check-out must be in the future.' }
  }

  const occupant = await roomHasBoardOccupant(client, room, params.businessDate)
  if (occupant.occupied) {
    return { error: `Room ${room} already has a guest on the board.` }
  }

  const blocks = await fetchActiveBlocksByRoom(client)
  const block = blocks.get(room) ?? null
  if (isRoomBlockBlockingEncode(block, null, null)) {
    return { error: `Room ${room} is blocked — unblock before adding a guest.` }
  }

  const hkStatus = await fetchRoomHkStatus(client, room)
  if (!isRoomAvailableForNewCheckIn(hkStatus)) {
    return {
      error: `Room ${room} is not available for check-in on the housekeeping board.`,
    }
  }

  const confirmation_number = `WALK-${room}-${Date.now().toString(36).toUpperCase()}`
  const check_out_date = datePartFromDateTimeInput(params.checkoutTime)

  const { error: insErr } = await client.from('reservations').insert({
    confirmation_number,
    pms_source: 'synxis',
    guest_name: guestName,
    reservation_status: 'pending',
    dnr_hit: false,
    version: 1,
    check_in_date: params.businessDate,
    check_out_date,
    room_number: room,
    scrape_payload: {
      phone: params.phone?.trim() || undefined,
      extension_keys_board_walk_in: true,
    },
  })
  if (insErr) return { error: insErr.message }

  const { error: auditErr } = await insertAuditRow(client, {
    action_type: 'extension_keys_board_add_guest',
    user_id: ctx.userId,
    username: ctx.username,
    user_role: ctx.role,
    confirmation_number,
    description: `Extension Keys — guest added to Room ${room}`,
    new_value: { room_number: room, guest_name: guestName },
  })
  if (auditErr) return { error: auditErr.message }

  return { error: null, confirmationNumber: confirmation_number }
}

export async function keysMoveRoomSw(
  client: SupabaseClient,
  params: {
    fromRoom: string
    toRoom: string
    confirmationNumber: string
    guestName?: string | null
    businessDate: string
  },
  ctx: KeysBoardWriteContext,
): Promise<{ error: string | null; keyReminder?: string }> {
  const fromRoom = params.fromRoom.trim()
  const toRoom = params.toRoom.trim()
  const conf = params.confirmationNumber.trim()
  if (!fromRoom || !toRoom || !conf) return { error: 'Room and confirmation are required.' }
  if (fromRoom === toRoom) return { error: 'Choose a different room than the current room.' }

  const destOccupant = await roomHasBoardOccupant(client, toRoom, params.businessDate)
  if (destOccupant.occupied) {
    return { error: `Room ${toRoom} already has a guest on the board.` }
  }

  const blocks = await fetchActiveBlocksByRoom(client)
  const destBlock = blocks.get(toRoom) ?? null
  if (isRoomBlockBlockingEncode(destBlock, destOccupant.confirmation, conf)) {
    return { error: `Room ${toRoom} is blocked — unblock or pick another room.` }
  }

  const hkStatus = await fetchRoomHkStatus(client, toRoom)
  if (!isRoomAvailableForNewCheckIn(hkStatus)) {
    return {
      error: `Room ${toRoom} is not available for check-in on the housekeeping board.`,
    }
  }

  const { data: existingRes } = await client
    .from('reservations')
    .select('id, pms_source')
    .eq('confirmation_number', conf)
    .maybeSingle()

  if (existingRes) {
    const pms = String((existingRes as { pms_source?: string }).pms_source ?? 'synxis')
    let updErr = (
      await client
        .from('reservations')
        .update({ room_number: toRoom })
        .eq('confirmation_number', conf)
        .eq('pms_source', pms)
    ).error
    if (updErr) {
      const retry = await client
        .from('reservations')
        .update({ room_number: toRoom })
        .eq('confirmation_number', conf)
      updErr = retry.error
    }
    if (updErr) return { error: updErr.message }
  } else {
    const { error: insErr } = await client.from('reservations').insert({
      confirmation_number: conf,
      pms_source: 'synxis',
      guest_name: params.guestName?.trim() || null,
      reservation_status: 'pending',
      dnr_hit: false,
      version: 1,
      check_in_date: params.businessDate,
      check_out_date: params.businessDate,
      room_number: toRoom,
    })
    if (insErr) return { error: insErr.message }
  }

  const { error: auditErr } = await insertAuditRow(client, {
    action_type: 'extension_keys_board_room_change',
    user_id: ctx.userId,
    username: ctx.username,
    user_role: ctx.role,
    confirmation_number: conf,
    description: `Extension Keys — room change ${fromRoom} → ${toRoom} for ${params.guestName?.trim() || 'guest'}`,
    old_value: { room_number: fromRoom },
    new_value: { room_number: toRoom, guest_name: params.guestName?.trim() || null },
  })
  if (auditErr) return { error: auditErr.message }

  let keyReminder: string | undefined
  const fromBlock = blocks.get(fromRoom) ?? null
  if (isDeferredMaintenanceBlock(fromBlock)) {
    const { error: moveKeyAuditErr } = await insertAuditRow(client, {
      action_type: 'room_block_guest_moved_key_reminder',
      user_id: ctx.userId,
      username: ctx.username,
      user_role: ctx.role,
      confirmation_number: conf,
      description: `Guest moved from Room ${fromRoom} to ${toRoom}. Void RFID keys for the old room on the encoder.`,
      new_value: { from_room: fromRoom, to_room: toRoom, block_id: fromBlock?.id ?? null },
    })
    if (moveKeyAuditErr) {
      keyReminder = 'Room moved, but key reminder audit failed.'
    } else {
      keyReminder = `Void or retire RFID keys for old Room ${fromRoom} on the encoder.`
    }
  }

  return { error: null, keyReminder }
}

export async function keysRemoveGuestSw(
  client: SupabaseClient,
  params: {
    roomNumber: string
    confirmationNumber: string
    guestName?: string | null
    businessDate: string
  },
  ctx: KeysBoardWriteContext,
): Promise<{ error: string | null; keyReminder?: string }> {
  const room = params.roomNumber.trim()
  const conf = params.confirmationNumber.trim()
  if (!room || !conf) return { error: 'Room and confirmation are required.' }

  const { data: existingRes } = await client
    .from('reservations')
    .select('id')
    .eq('confirmation_number', conf)
    .maybeSingle()

  if (existingRes) {
    const { error: updErr } = await client
      .from('reservations')
      .update({ reservation_status: 'checked_out' })
      .eq('confirmation_number', conf)
    if (updErr) return { error: updErr.message }
  } else {
    const { error: insErr } = await client.from('reservations').insert({
      confirmation_number: conf,
      pms_source: 'synxis',
      guest_name: params.guestName?.trim() || null,
      reservation_status: 'checked_out',
      dnr_hit: false,
      version: 1,
      check_in_date: params.businessDate,
      check_out_date: params.businessDate,
      room_number: room,
    })
    if (insErr) return { error: insErr.message }
  }

  const { error: auditErr } = await insertAuditRow(client, {
    action_type: 'extension_keys_board_remove_guest',
    user_id: ctx.userId,
    username: ctx.username,
    user_role: ctx.role,
    confirmation_number: conf,
    description: `Extension Keys — removed ${params.guestName?.trim() || 'guest'} from Room ${room}`,
    new_value: {
      room_number: room,
      guest_name: params.guestName?.trim() || null,
      reservation_status: 'checked_out',
    },
  })
  if (auditErr) return { error: auditErr.message }

  const { error: hkErr } = await client.rpc("hk_mark_room_dirty", {
    p_room_number: room,
    p_notes: "Auto: guest checkout (keys board)",
  })
  if (hkErr && !/already|dirty|open task|in service|duplicate/i.test(hkErr.message)) {
    console.warn(`[keys] Auto dirty on checkout failed for room ${room}:`, hkErr.message)
  }

  const blocks = await fetchActiveBlocksByRoom(client)
  const block = blocks.get(room) ?? null
  let keyReminder: string | undefined
  if (isDeferredMaintenanceBlock(block)) {
    const { error: lockAuditErr } = await insertAuditRow(client, {
      action_type: 'room_block_guest_departed_key_reminder',
      user_id: ctx.userId,
      username: ctx.username,
      user_role: ctx.role,
      confirmation_number: conf,
      description: `Guest departed Room ${room} — void or lock RFID keys on the encoder.`,
      new_value: { room_number: room, block_id: block?.id ?? null },
    })
    if (!lockAuditErr) {
      keyReminder = `Void or lock RFID keys for Room ${room} on the encoder.`
    }
  }

  return { error: null, keyReminder }
}
