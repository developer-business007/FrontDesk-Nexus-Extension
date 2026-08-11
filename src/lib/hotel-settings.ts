import {
  clampSeniorRecommendAge,
  DEFAULT_SENIOR_RECOMMEND_SETTINGS,
  parseSeniorPreferredFloors,
  sanitizeSeniorRoomList,
} from './senior-room-recommend'

/** Subset of portal `app_settings` key `hotel` used by the extension. */
export type ExtensionHotelSettings = {
  /** Minimum age to rent a room; 0 = do not warn on scan. Default 18. */
  minimumCheckInAge: number
  /** Maximum allowed guest balance before key encoding is blocked. -1 = disabled. */
  maxAllowedBalance: number
  /** Manager PIN to override key-encoding blocks. Empty string = override disabled. */
  managerOverridePin: string
  /** Minutes of inactivity before the extension auto-logs out. 0 = disabled. Default 480. */
  autoLogoutMinutes: number
  /** Hotel identity for PDF exports. */
  hotelName: string
  hotelAddress: string
  hotelCity: string
  hotelState: string
  hotelZip: string
  hotelPhone: string
  hotelEmail: string
  /** Cash deposit amount (USD) for Cash Deposit Receipt PDF. */
  cashDepositAmount: number
  /** Default departure / key-expiry clock time, "HH:MM" 24h. */
  defaultCheckoutTime: string
  /** Emergency write access for all front desk accounts (extension Keys board) until ISO time. */
  frontDeskKeysWriteAccessUntil: string | null
  /** Default number of days for front desk manual keys (pre-fills checkout; editable). */
  frontDeskDefaultKeyDays: number
  /** When true, pre-fill checkout using {@link frontDeskDefaultKeyDays}. */
  frontDeskDefaultKeyDaysEnabled: boolean
  /** When true, suggest senior-friendly vacant rooms after ID scan. */
  seniorRecommendEnabled: boolean
  /** Minimum guest age (years) to show senior room recommendations. 0 = disabled. */
  seniorRecommendAge: number
  /** Preferred floors when no custom senior room list is set. */
  seniorPreferredFloors: number[]
  /** Optional comma/range list overriding floor preference (e.g. accessible rooms). */
  seniorPreferredRoomList: string
}

export const DEFAULT_EXTENSION_HOTEL_SETTINGS: ExtensionHotelSettings = {
  minimumCheckInAge: 18,
  maxAllowedBalance: -1,
  managerOverridePin: '',
  autoLogoutMinutes: 480,
  hotelName: '',
  hotelAddress: '',
  hotelCity: '',
  hotelState: '',
  hotelZip: '',
  hotelPhone: '',
  hotelEmail: '',
  cashDepositAmount: 100,
  defaultCheckoutTime: '11:00',
  frontDeskKeysWriteAccessUntil: null,
  frontDeskDefaultKeyDays: 1,
  frontDeskDefaultKeyDaysEnabled: true,
  ...DEFAULT_SENIOR_RECOMMEND_SETTINGS,
}

function clampMinimumCheckInAge(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return DEFAULT_EXTENSION_HOTEL_SETTINGS.minimumCheckInAge
  }
  return Math.max(0, Math.min(99, Math.floor(n)))
}

function clampMaxAllowedBalance(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return -1
  if (n < 0) return -1
  return Math.round(n * 100) / 100
}

function sanitizeManagerOverridePin(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, 32)
}

function clampAutoLogoutMinutes(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_EXTENSION_HOTEL_SETTINGS.autoLogoutMinutes
  if (n <= 0) return 0
  return Math.round(Math.max(1, n))
}

function sanitizeStr(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, 255)
}

function sanitizeHhmm(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_EXTENSION_HOTEL_SETTINGS.defaultCheckoutTime
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return DEFAULT_EXTENSION_HOTEL_SETTINGS.defaultCheckoutTime
  const h = Math.max(0, Math.min(23, Number.parseInt(m[1]!, 10)))
  const mm = Math.max(0, Math.min(59, Number.parseInt(m[2]!, 10)))
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function sanitizeIsoOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function clampFrontDeskKeyDays(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_EXTENSION_HOTEL_SETTINGS.frontDeskDefaultKeyDays
  return Math.max(1, Math.min(30, Math.floor(n)))
}

function clampCashDeposit(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_EXTENSION_HOTEL_SETTINGS.cashDepositAmount
  return Math.max(0, Math.round(n * 100) / 100)
}

export function parseHotelSettingsValue(value: unknown): ExtensionHotelSettings {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    minimumCheckInAge: clampMinimumCheckInAge(v.minimumCheckInAge),
    maxAllowedBalance: clampMaxAllowedBalance(v.maxAllowedBalance),
    managerOverridePin: sanitizeManagerOverridePin(v.managerOverridePin),
    autoLogoutMinutes: clampAutoLogoutMinutes(v.autoLogoutMinutes),
    defaultCheckoutTime: sanitizeHhmm(v.defaultCheckoutTime),
    hotelName: sanitizeStr(v.hotelName),
    hotelAddress: sanitizeStr(v.hotelAddress),
    hotelCity: sanitizeStr(v.hotelCity),
    hotelState: sanitizeStr(v.hotelState),
    hotelZip: sanitizeStr(v.hotelZip),
    hotelPhone: sanitizeStr(v.hotelPhone),
    hotelEmail: sanitizeStr(v.hotelEmail),
    cashDepositAmount: clampCashDeposit(v.cashDepositAmount),
    frontDeskKeysWriteAccessUntil: sanitizeIsoOrNull(v.frontDeskKeysWriteAccessUntil),
    frontDeskDefaultKeyDays: clampFrontDeskKeyDays(v.frontDeskDefaultKeyDays),
    frontDeskDefaultKeyDaysEnabled: Boolean(
      v.frontDeskDefaultKeyDaysEnabled ?? DEFAULT_EXTENSION_HOTEL_SETTINGS.frontDeskDefaultKeyDaysEnabled,
    ),
    seniorRecommendEnabled: Boolean(
      v.seniorRecommendEnabled ?? DEFAULT_EXTENSION_HOTEL_SETTINGS.seniorRecommendEnabled,
    ),
    seniorRecommendAge: clampSeniorRecommendAge(
      v.seniorRecommendAge ?? DEFAULT_EXTENSION_HOTEL_SETTINGS.seniorRecommendAge,
    ),
    seniorPreferredFloors: parseSeniorPreferredFloors(
      v.seniorPreferredFloors ?? DEFAULT_EXTENSION_HOTEL_SETTINGS.seniorPreferredFloors,
    ),
    seniorPreferredRoomList: sanitizeSeniorRoomList(v.seniorPreferredRoomList),
  }
}
