import {
  FunctionsFetchError,
  FunctionsHttpError,
  type SupabaseClient,
} from '@supabase/supabase-js'
import {
  emptyPmsBoardRow,
  type PmsBoardDataPayload,
  type PmsBoardRow,
  type PmsRoomtypeCounts,
  type PmsSyncRunResult,
  type PmsSyncState,
} from '../shared/pms-board-types'
import { parsePmsCents } from './pms-board-display'

const PMS_BOARD_SELECT = [
  'room_number',
  'room_type',
  'status',
  'synxis_hk_status',
  'synxis_occupancy',
  'synxis_ooo_code',
  'synxis_guest_name',
  'synxis_check_in_date',
  'synxis_check_out_date',
  'synxis_balance_cents',
  'ezee_hk_status',
  'ezee_occupancy',
  'ezee_guest_name',
  'ezee_check_in_date',
  'ezee_check_out_date',
  'ezee_balance_cents',
  'ezee_booking_status',
  'merged_guest_name',
  'merged_check_in_date',
  'merged_check_out_date',
  'merged_balance_cents',
  'sold_by',
  'synxis_synced_at',
  'ezee_synced_at',
  'pms_updated_at',
].join(', ')

function normalizePmsBoardRow(row: Record<string, unknown>): PmsBoardRow {
  const base = row as unknown as PmsBoardRow
  return {
    ...base,
    synxis_balance_cents: parsePmsCents(row.synxis_balance_cents),
    ezee_balance_cents: parsePmsCents(row.ezee_balance_cents),
    merged_balance_cents: parsePmsCents(row.merged_balance_cents),
  }
}

export async function fetchHotelRoomNumbers(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from('rooms')
    .select('room_number')
    .eq('is_active', true)
    .order('room_number', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => String((r as { room_number: string }).room_number))
}

export async function fetchPmsBoardRows(client: SupabaseClient): Promise<PmsBoardRow[]> {
  const { data, error } = await client
    .from('room_operational_status')
    .select(PMS_BOARD_SELECT)
    .order('room_number', { ascending: true })

  if (error) {
    if (/column|schema cache|does not exist/i.test(error.message)) {
      return []
    }
    throw new Error(error.message)
  }
  return (data ?? []).map((row) => normalizePmsBoardRow(row as unknown as Record<string, unknown>))
}

export function buildPmsBoardFromInventory(
  inventory: string[],
  pmsRows: PmsBoardRow[],
): PmsBoardRow[] {
  const byRoom = new Map<string, PmsBoardRow>()
  for (const row of pmsRows) {
    const rn = String(row.room_number ?? '').trim()
    if (rn) byRoom.set(rn, row)
  }
  return inventory.map((roomNumber) => byRoom.get(roomNumber) ?? emptyPmsBoardRow(roomNumber))
}

export async function fetchPmsSyncState(client: SupabaseClient): Promise<PmsSyncState> {
  const { data, error } = await client
    .from('app_settings')
    .select('value')
    .eq('key', 'pms_sync_state')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data?.value ?? {}) as PmsSyncState
}

export async function fetchPmsRoomtypeCounts(client: SupabaseClient): Promise<PmsRoomtypeCounts> {
  const { data, error } = await client
    .from('app_settings')
    .select('value')
    .eq('key', 'pms_roomtype_counts')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data?.value ?? {}) as PmsRoomtypeCounts
}

export async function fetchPmsBoardData(client: SupabaseClient): Promise<PmsBoardDataPayload> {
  const [roomNumbers, pmsRows, syncState, roomtypeCounts] = await Promise.all([
    fetchHotelRoomNumbers(client),
    fetchPmsBoardRows(client),
    fetchPmsSyncState(client),
    fetchPmsRoomtypeCounts(client),
  ])
  return {
    roomNumbers,
    boardRows: buildPmsBoardFromInventory(roomNumbers, pmsRows),
    syncState,
    roomtypeCounts,
  }
}

function parsePmsSyncRunResult(data: unknown): PmsSyncRunResult | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const row = data as Record<string, unknown>
  if (typeof row.error === 'string' && row.error && row.ok === false && !row.synxis && !row.ezee) {
    throw new Error(row.error)
  }
  if (typeof row.at === 'string' && row.synxis && row.ezee) {
    return row as PmsSyncRunResult
  }
  return null
}

async function readPmsSyncFromHttpError(error: FunctionsHttpError): Promise<PmsSyncRunResult | null> {
  const response = error.context as Response | undefined
  if (!response) return null
  try {
    return parsePmsSyncRunResult(await response.json())
  } catch {
    return null
  }
}

export async function triggerPmsSync(client: SupabaseClient): Promise<PmsSyncRunResult> {
  const { data, error } = await client.functions.invoke('pms-sync', { body: {} })
  if (!error) {
    const parsed = parsePmsSyncRunResult(data)
    if (parsed) return parsed
    throw new Error('Invalid sync response from server')
  }

  if (error instanceof FunctionsHttpError) {
    const parsed = await readPmsSyncFromHttpError(error)
    if (parsed) return parsed
  }

  if (error instanceof FunctionsFetchError || error.message.includes('Failed to send')) {
    throw new Error('PMS sync function not reachable. Deploy the pms-sync edge function to Supabase.')
  }

  throw new Error(error.message)
}
