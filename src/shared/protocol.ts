import type {
  EzeeGroupMember,
  EzeeGuestDisplay,
  IdScanDetailGuru,
  ParsedIdFields,
  ReservationSnapshot,
  SynxisGuestDisplay,
} from './pms-types'
import type { PmsBoardDataPayload, PmsSyncRunResult } from './pms-board-types'

export type { IdScanDetailGuru }

/** Minimum time guest draft must sit before passive logout auto-save (portal bridge / session end). */
export const GUEST_DRAFT_AUTOSAVE_MIN_MS = 2 * 60 * 1000

/** Side panel → service worker: guest ID draft for logout auto-save. */
export type PendingGuestDraft = {
  canceled: boolean
  draftStartedAtMs: number
  parsed: ParsedIdFields
  phone: string | null
  email: string | null
  manualEntry: boolean
  managerOverride: boolean
  imageFrontBase64: string | null
  imageBackBase64: string | null
  ocrProvider?: string | null
  detail?: IdScanDetailGuru | null
  documentData?: Record<string, unknown> | null
  guestRemark?: string | null
  checkInRemark?: string | null
}

export const FDN_PENDING_GUEST_DRAFT_KEY = 'fdn_pending_guest_draft' as const
/** True while guest reg-card signature popup is open (pauses extension idle reset). */
export const FDN_REG_CARD_SIGNING_ACTIVE_KEY = 'fdn_reg_card_signing_active' as const


/** chrome.runtime / Port message contracts (see docs/MESSAGING.md) */
/** Prior scans for the current reservation confirmation (Supabase `id_scans`). */
export type IdScanHistoryRow = {
  id: string
  confirmationNumber: string
  scannedAt: string
  manualEntry: boolean
}

/** Check-in history log row (portal ID Data — by date). */
export type IdScanLogEntry = {
  id: string
  confirmationNumber: string
  scannedAt: string
  manualEntry: boolean
  ocrProvider: string | null
  terminalId: string | null
  scannedBy: string | null
  agentLabel: string
  displayName: string
  roomNumber: string | null
  reservationGuestName: string | null
  checkInDate: string | null
  checkOutDate: string | null
  imageFrontPath: string | null
  imageBackPath: string | null
  phone: string | null
  email: string | null
  firstName: string | null
  middleName: string | null
  lastName: string | null
  fullName: string | null
  dateOfBirth: string | null
  idNumber: string | null
  idType: string | null
  issueDate: string | null
  expiryDate: string | null
  streetAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  address: string | null
  piiError: string | null
}

/** Keys room board row (portal Keys → Room board). */
export type KeyBoardEntry = {
  roomNumber: string
  guestName: string | null
  confirmationNumber: string | null
  checkinTime: string | null
  checkoutTime: string | null
  encodedBy: string | null
  cardSerial: number | null
  blocked: boolean
  blockSummary: string | null
  blockId: string | null
  deferredBlock: boolean
  roomStatus: string | null
  hasKey: boolean
}

/** Clerk input: room type + how many rooms needed (multi-room bookings). */
export type SeniorRoomTypeRequest = {
  roomType: string
  count: number
}

export type SeniorRoomRecommendGroup = {
  roomType: string
  count: number
  rooms: { roomNumber: string; floor: number | null; roomType?: string | null }[]
}

export type SeniorRoomClusterQuality = 'adjacent' | 'nearby' | 'split' | 'none'

/** Senior room hint returned after ID scan for guests at or above {@link seniorRecommendAge}. */
export type SeniorRoomRecommendResult = {
  recommended: { roomNumber: string; floor: number | null; roomType?: string | null }[]
  groups: SeniorRoomRecommendGroup[]
  floor: number | null
  sameFloorCluster: boolean
  clusterQuality: SeniorRoomClusterQuality
  notes: string[]
  needsGuestConfirmation: boolean
  fallback: { roomNumber: string; floor: number | null; roomType?: string | null }[]
  usedCustomList: boolean
  preferredFloors: number[]
  busyCount: number
  propertyLayoutId: string | null
}

/** Keys encode ledger row. */
export type KeyLedgerEntry = {
  id: string
  roomNumber: string
  guestName: string | null
  confirmationNumber: string
  cardSerial: number | null
  checkinTime: string | null
  checkoutTime: string | null
  encodedBy: string | null
  encodedAt: string
}

export type RoomBlockEntry = {
  id: string
  roomNumber: string
  blockedUntil: string | null
  reason: string | null
  createdAt: string
  effectiveFromVacancy: boolean
}

export type KeyBoardStats = {
  total: number
  withKey: number
  vacant: number
}

/** Signature PDF log row (portal PDFs tab). */
export type SignatureLogEntry = {
  id: string
  confirmationNumber: string
  storagePath: string
  signedByUsername: string | null
  terminalId: string | null
  createdAt: string
  roomNumber: string | null
  guestName: string | null
  checkInDate: string | null
  checkOutDate: string | null
  /** Path in guest-signatures category (B2 / legacy Supabase) — encrypted PNG. */
  signatureImagePath: string | null
}

/** Prior guest profile from another stay (lookup by phone hash). */
export type GuestStayHistoryRecord = {
  id: string
  confirmationNumber: string
  scannedAt: string
  manualEntry: boolean
  phone: string | null
  email: string | null
  fullName: string | null
  firstName: string | null
  middleName: string | null
  lastName: string | null
  streetAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  dateOfBirth: string | null
  idNumber: string | null
  idType: string | null
  issueDate: string | null
  expiryDate: string | null
  address: string | null
}

/** A single prior visit found by matching the scanned ID number hash across all reservations. */
export type ReturningGuestRecord = {
  id: string
  confirmationNumber: string
  scannedAt: string
  /** Decrypted from phone_encrypted — null if not saved or decryption failed. */
  phone: string | null
  /** Decrypted from email_encrypted — null if not saved or decryption failed. */
  email: string | null
}

/** Key card encoding records for the current reservation (Supabase `key_history`). */
export type KeyHistoryRow = {
  id: string
  confirmation_number: string
  room_number: string
  card_serial: number
  checkin_time: string
  checkout_time: string
  encoded_by_username: string | null
  created_at: string
}

export type ExtensionMessage =
  | { type: 'GET_STATE' }
  | { type: 'REFRESH_BALANCE' }
  | { type: 'GET_ID_SCAN_HISTORY' }
  /** Keys board / key ledger: load the most recent ID scan for a confirmation. */
  | { type: 'GET_LATEST_ID_SCAN_FOR_CONFIRMATION'; confirmationNumber: string }
  /** ID Data by date range (portal “By date” tab). */
  | { type: 'GET_ID_SCANS_BY_DATE'; fromDate: string; toDate: string }
  /** Guest lookup across recent scans (name, phone, ID, confirmation). */
  | { type: 'SEARCH_ID_SCANS_HISTORY'; query: string }
  /** Signature PDFs by signed date range. */
  | { type: 'GET_SIGNATURES_BY_DATE'; fromDate: string; toDate: string; agentFilter?: string }
  /** Verify hotel manager/admin PIN (download & export on PDFs tab). */
  | { type: 'VERIFY_MANAGER_PIN'; pin: string }
  /** Portal Keys — room board for a business date. */
  | { type: 'GET_KEY_BOARD'; businessDate: string; agentFilter?: string }
  /** Dual PMS board — room_operational_status merged with inventory. */
  | { type: 'GET_PMS_BOARD_DATA' }
  /** Trigger pms-sync edge function (SynXis + eZee → Supabase). */
  | { type: 'TRIGGER_PMS_SYNC' }
  /** Queue SynXis clean/dirty on DualPMS VPS (same as original DualPMS webapp). */
  | {
      type: 'REQUEST_PMS_HOUSEKEEPING'
      roomNumbers: string[]
      status: 'clean' | 'dirty'
    }
  /** Vacant senior-friendly rooms for ID scan hint (DualPMS room_operational_status). */
  | {
      type: 'GET_SENIOR_ROOM_RECOMMENDATIONS'
      businessDate?: string
      roomRequests?: SeniorRoomTypeRequest[]
    }
  /** Portal Keys — encode ledger for date range. */
  | {
      type: 'GET_KEY_LEDGER'
      fromDate: string
      toDate: string
      agentFilter?: string
      roomFilter?: string
    }
  /** Block a room (admin or manager PIN). */
  | {
      type: 'CREATE_ROOM_BLOCK'
      roomNumber: string
      durationKind: 'hours' | 'days' | 'unlimited'
      durationValue?: number
      reason?: string
      effectiveFromVacancy?: boolean
      managerPin?: string
    }
  /** Release an active room block. */
  | { type: 'RELEASE_ROOM_BLOCK'; blockId: string; roomNumber: string; managerPin?: string }
  /** Admin-style encode from Keys board (admin or manager PIN). */
  | {
      type: 'KEYS_ADMIN_ENCODE'
      roomNumber: string
      checkinTime: string
      checkoutTime: string
      confirmationNumber: string
      guestName?: string | null
      cardSerial?: number
      managerPin?: string
      /** Front desk re-encoding an occupied room — skips PIN requirement, uses existing PMS dates. */
      frontDeskOccupied?: boolean
    }
  /** Keys board — walk-in guest + first key (admin or manager PIN). */
  | {
      type: 'KEYS_ADD_GUEST'
      roomNumber: string
      guestName: string
      checkinTime: string
      checkoutTime: string
      phone?: string | null
      managerPin?: string
    }
  /** Keys board — move in-house guest to another room and encode one key (admin or manager PIN). */
  | {
      type: 'KEYS_MOVE_ROOM'
      fromRoom: string
      toRoom: string
      confirmationNumber: string
      guestName?: string | null
      checkinTime: string
      checkoutTime: string
      managerPin?: string
    }
  /** Keys board — mark guest checked out so room shows vacant (admin or manager PIN). */
  | {
      type: 'KEYS_REMOVE_GUEST'
      roomNumber: string
      confirmationNumber: string
      guestName?: string | null
      managerPin?: string
    }
  | { type: 'GET_KEY_HISTORY' }
  | { type: 'LOAD_SYNXIS_RESERVATION' }
  /** Manual scrape: eZee tab with Arrivals drawer open (same payload as auto). */
  | { type: 'LOAD_EZEE_RESERVATION' }
  /** Key encode: switch active sub-reservation in an eZee group stay. */
  | { type: 'SELECT_EZEE_GROUP_MEMBER'; index: number }
  /** Content script on sph.synxis.com: Guest Stay Record detected, confirmation extracted from DOM. */
  | { type: 'SYNXIS_AUTO_GUEST_DETECTED'; confirmation: string; roomHint?: string | null }
  /** Content script on sph.synxis.com: user clicked "Print Basic Registration Card" in the toolbar. */
  | { type: 'SYNXIS_PRINT_BASIC_CARD_CLICKED' }
  /** Content script on live.ipms247.com: Ant Design guest drawer scraped. */
  | {
      type: 'EZEE_AUTO_GUEST_DETECTED'
      snapshot: ReservationSnapshot
      guestDisplay: EzeeGuestDisplay
      groupMembers?: EzeeGroupMember[]
      activeGroupIndex?: number
    }
  /** Folio / non-guest tab — clear stale eZee panel data in the service worker. */
  | { type: 'EZEE_SUPPRESS_GUEST_LOAD' }
  /** Content script on live.ipms247.com: user clicked "Print Guest Registration Card". */
  | { type: 'EZEE_PRINT_BASIC_CARD_CLICKED'; confirmation: string }
  /** Content script captured the Stimulsoft report URL — service worker opens the reg-card popup. */
  | { type: 'EZEE_OPEN_REG_CARD'; ezeeReportUrl: string; confirmation: string }
  /** Injected sign overlay on Stimulsoft popup — save PNG signature as PDF to Supabase. */
  | {
      type: 'EZEE_SAVE_SIGNATURE'
      signaturePng: string
      confirmation: string
      /** Real Stimulsoft PDF bytes (base64) if the JS API export succeeded. */
      cardPdfBase64?: string | null
      /** Stimulsoft canvas PNG (base64) if PDF export was unavailable. */
      cardImageBase64?: string | null
    }
  | { type: 'AUTH_DEV_LOGIN'; email: string; password: string }
  | { type: 'AUTH_LOGOUT' }
  | {
      type: 'BRIDGE_SET_SESSION'
      accessToken: string
      refreshToken: string
      expiresAt?: number
    }
  | {
      type: 'SAVE_ID_SCAN'
      parsed: ParsedIdFields
      phone: string | null
      email: string | null
      manualEntry: boolean
      managerOverride: boolean
      imageFrontBase64: string | null
      imageBackBase64: string | null
      /** `native_host` when data came from Thales/native host; omit for manual entry. */
      ocrProvider?: string | null
      detail?: IdScanDetailGuru | null
      documentData?: Record<string, unknown> | null
      guestRemark?: string | null
      checkInRemark?: string | null
      /** When set, updates this `id_scans` row instead of inserting a duplicate. */
      existingScanId?: string | null
    }
  | { type: 'INJECT_PMS'; fields: Record<string, string> }
  | { type: 'VERIFY_MANAGER'; email: string; password: string }
  /** Active DNR row for scanned / typed ID number (normalized + raw variants). */
  | { type: 'CHECK_DNR'; idNumber: string }
  /** Manager/admin adds guest to DNR after password verification (extension side panel). */
  | {
      type: 'ADD_DNR'
      guestName: string
      idNumber: string
      dateOfBirth: string | null
      reason: string
      managerEmail: string
      managerPassword: string
    }
  | {
      type: 'SAVE_SIGNATURE'
      /** Base64-encoded signed PDF bytes (from pdf-lib save()). */
      pdfBase64: string
      confirmationNumber: string
      /** Data-URL PNG of the raw signature stroke — stored encrypted for reuse in other PDFs. */
      signaturePng?: string | null
    }
  | {
      type: 'WINDOW_CONTROL'
      action: 'minimize' | 'restore'
      processName: string
    }
  /** Open built-in hotel policy on the guest-facing (2nd) display. */
  | { type: 'OPEN_HOTEL_POLICY' }
  | {
      type: 'RFID_MAKE_KEY'
      /** Room number as displayed in PMS (e.g. "101", "600"). Python formats it to SDK 8-char. */
      roomNumber: string
      /** ISO datetime or SDK format (yyyyMMddHHmm). */
      checkinTime: string
      checkoutTime: string
      /** 1 = primary key card, 2–8 = duplicate copies. Defaults to 1. */
      cardSerial?: number
      /**
       * When set (portal admin walk-in / manual encode), `key_history` uses this confirmation
       * instead of the scraped PMS reservation. Requires signed-in extension session.
       */
      confirmationNumber?: string
      /** Persisted to `key_history.guest_name`; shown on the Keys board for walk-in / vacant-room encodes. */
      guestName?: string | null
      /**
       * Admin-only: log `encoded_by_username` as **Admin** (PMS-style) and require `cachedRole === 'admin'`.
       */
      portalAdminEncode?: boolean
      /** Manager override PIN to bypass check-in / balance gates. */
      managerPin?: string
    }
  | { type: 'RFID_READ_CARD' }
  /**
   * Encode a cancel/disable payload onto an old card.
   * The guest taps the card on their room lock — the lock deactivates all previous keys.
   * Then a new key can be encoded normally.
   */
  /**
   * Lost key replacement: encode a new guest card [00] with serial 1 and a fresh check-in time.
   * When the guest taps the new card at the door, the lock automatically invalidates the old key.
   * No disable card needed.
   */
  | { type: 'RFID_MAKE_LOST_KEY'; roomNumber: string; checkoutTime: string }
  /** Force a real HandShake() check and return updated hardware state. */
  | { type: 'RFID_CHECK_CONNECTION' }
  /** Switch the active ID scanner; persisted in Chrome storage. */
  | { type: 'SELECT_SCANNER'; scanner: 'thales' | 'twain' }
  /** Fire a TWAIN scan on the currently selected TWAIN device (Ambir DS690gt). */
  | { type: 'TRIGGER_SCAN_TWAIN' }
  /** Look up previous scans by ID number hash to detect returning guests. */
  | { type: 'GET_RETURNING_GUEST_HISTORY'; idNumber: string }
  /** Look up prior stays / ID profiles by phone number hash. */
  | { type: 'GET_GUEST_HISTORY_BY_PHONE'; phone: string }
  /** Search PMS reservations by last name — fills the search field on the active PMS tab. */
  | { type: 'FIND_GUEST_IN_PMS'; lastName: string }
  /** Clear the in-memory reservation snapshot — called on Save & Clear / Cancel. */
  | { type: 'CLEAR_RESERVATION' }
  /** Fetch latest room/checkout/folio from id_scans for a guest ID number. */
  | { type: 'GET_SCAN_RESERVATION_DATA'; idNumber: string }
  /** Return all active reservations whose guest name matches the scanned ID name. */
  | { type: 'GET_MATCHING_RESERVATIONS'; guestName: string }
export type ReservationCandidate = {
  confirmationNumber: string
  roomNumber: string | null
  checkOutDate: string | null
  checkInDate: string | null
  guestName: string | null
}
export type ScanReservationData = {
  roomNumber: string | null
  checkOutDate: string | null
  confirmationNumber: string | null
}
export type ExtensionResponse =
  | {
      ok: true
      state?: ExtensionState
      idScanHistory?: IdScanHistoryRow[]
      idScanLog?: IdScanLogEntry[]
      signatureLog?: SignatureLogEntry[]
      keyBoard?: KeyBoardEntry[]
      keyBoardStats?: KeyBoardStats
      keyLedger?: KeyLedgerEntry[]
      keyHistory?: KeyHistoryRow[]
      signaturePath?: string
      signatureImagePath?: string
      returningGuestHistory?: ReturningGuestRecord[]
      guestStayHistory?: GuestStayHistoryRecord[]
      /** Present after `CHECK_DNR` or `ADD_DNR`. */
      dnrActive?: boolean
      /** Present after `GET_SCAN_RESERVATION_DATA`. */
      scanReservationData?: ScanReservationData
      /** Present after `GET_MATCHING_RESERVATIONS`. */
      matchingReservations?: ReservationCandidate[]
      /** Keys board — maintenance / departure key reminder after move or remove. */
      keyReminder?: string
      /** Keys board — room selected after a successful move. */
      movedToRoom?: string
      /** Senior-friendly vacant rooms for ID scan hint. */
      seniorRoomRecommendations?: SeniorRoomRecommendResult
      /** Dual PMS board payload. */
      pmsBoardData?: PmsBoardDataPayload
      /** Last pms-sync edge function result. */
      pmsSyncResult?: PmsSyncRunResult
      /** Housekeeping queue confirmation. */
      hkMessage?: string
      dbWarning?: string
    }
  | { ok: false; error: string; keyBlocks?: KeyBlock[] }

export type KeyBlockType = 'not_checked_in' | 'balance_over_threshold'
export type KeyBlock = { type: KeyBlockType; message: string }

/** Service worker → side panel: log native inbound (opens in side panel DevTools). */
export type NativeHostRxDebugBroadcast = {
  type: 'FDN_NATIVE_HOST_RX'
  receivedAt: string
  source: 'AUTO_SCAN_RESULT' | 'SCAN_RESULT' | 'ERROR' | 'other'
  topLevelKeys: string[]
  imageFrontB64Length?: number
  imageBackB64Length?: number
  legacySingleImageB64Length?: number
  documentDataKeys: string[]
  /** String / primitive preview (truncated); no full images. */
  documentDataPreview?: Record<string, string>
  parsedPreview?: Record<string, string | null>
  errorMessage?: string
  unhandledType?: string
}

/** Service worker → side panel: Thales/SDK host pushed a completed ID scan (no button). */
export type NativeIdScanBroadcast = {
  type: 'FDN_NATIVE_ID_SCAN'
  /** ISO time when the extension received this scan (for UI + audit). */
  receivedAt?: string
  parsed: ParsedIdFields
  /** May be empty when {@link imagesInStorage} is true (images in chrome.storage.local). */
  images: { front_image_base64: string; back_image_base64: string }
  imageBase64Length: number
  ocrProvider: 'native_host'
  /** When true, load images via `fdn_scan_image_front` / `fdn_scan_image_back` keys. */
  imagesInStorage?: boolean
  /** Structured fields from Python `document_data` / AUTO_SCAN_RESULT. */
  detail?: IdScanDetailGuru | null
  /** Raw snapshot for debugging / future use (not shown by default in UI). */
  documentData?: Record<string, unknown> | null
}

export type HardwareDevice = 'id_scanner' | 'spectral_payout' | 'rfid_encoder'

export type HardwareStatus = Record<HardwareDevice, 'connected' | 'disconnected'> & {
  /** TWAIN source names reported by DEVICE_STATUS (e.g. ['Ambir nScan 690gt']). */
  idScannerSources: string[]
  /** True when Thales MMMReader DLL loaded OK (SDK reachable). */
  thalesConnected: boolean
}

export type HotelContact = {
  name: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  email: string
  cashDepositAmount: number
}

export type ExtensionState = {
  auth: {
    signedIn: boolean
    email: string | null
    role: string | null
    userId: string | null
  }
  versionBlocked: boolean
  versionMessage: string | null
  reservation: ReservationSnapshot | null
  /** Parsed guest fields for side panel (SynXis reservation-summary). */
  synxisGuestDisplay: SynxisGuestDisplay | null
  /** eZee Arrivals drawer scrape. */
  ezeeGuestDisplay: EzeeGuestDisplay | null
  /** eZee group check-in sub-reservations (Key Encode room picker). */
  ezeeGroupMembers: EzeeGroupMember[]
  ezeeGroupActiveIndex: number
  hardware: HardwareStatus
  /** Unix ms when each device status was last probed (side panel “last checked”). */
  hardwareCheckedAt: {
    id_scanner: number | null
    rfid_encoder: number | null
  }
  rfidError: string | null
  terminalId: string | null
  dnrHit: boolean
  /** From `app_settings` key `hotel`; 0 = no underage warning. */
  minimumCheckInAge: number
  /** Maximum allowed balance before key encoding is blocked; -1 = disabled. */
  maxAllowedBalance: number
  /** True when a manager override PIN is configured in hotel settings. */
  hasManagerPin: boolean
  /** Minutes of inactivity before the extension auto-logs out; 0 = disabled. */
  autoLogoutMinutes: number
  /** Hotel identity and contact info from `app_settings` — used in PDF exports. */
  hotelContact: HotelContact
  /** Emergency access: front desk can Add guest + Move room until this ISO time (null = off). */
  frontDeskKeysWriteAccessUntil: string | null
  /** Default manual key duration (days) for front desk. */
  frontDeskDefaultKeyDays: number
  /** When true, pre-fill checkout using {@link frontDeskDefaultKeyDays}. */
  frontDeskDefaultKeyDaysEnabled: boolean
  /** Default checkout clock time (HH:MM) from hotel settings. */
  defaultCheckoutTime: string
  /** Senior room recommendation enabled (extension ID tab hint). */
  seniorRecommendEnabled: boolean
  /** Minimum age for senior room hint; 0 = disabled. */
  seniorRecommendAge: number
  lastError: string | null
  /** Which ID scanner the staff has chosen; persisted in Chrome storage. */
  selectedScanner: 'thales' | 'twain'
}

/** Service worker → side panel: two-pass DL scan, one side received (other not yet scanned). */
export type ScanSideBroadcast = {
  type: 'FDN_SCAN_SIDE_RESULT'
  side: 'front' | 'back'
  /** Empty when {@link imagesInStorage} is true. */
  imageBase64: string
  imagesInStorage?: boolean
}

/** @deprecated Use {@link ScanSideBroadcast} with side `front`. */
export type ScanFrontBroadcast = {
  type: 'FDN_SCAN_FRONT_RESULT'
  /** Empty when {@link imagesInStorage} is true. */
  imageFrontBase64: string
  imagesInStorage?: boolean
}

/** Native Messaging host id — must match Windows registry + host manifest `name`. */
export const NATIVE_HOST_NAME = 'com.frontdesk.nexus'

/** Service worker → side panel: transient success / warning banner. */
export type PanelToastBroadcast = {
  type: 'FDN_PANEL_TOAST'
  confirmationNumber: string
  detail?: string
  variant?: 'success' | 'warn'
}

/** Service worker / reg-card page → side panel: signature saved — show blank ID scan. */
export type RegCardSignatureCompleteBroadcast = {
  type: 'REG_CARD_SIGNATURE_COMPLETE'
}

/** Service worker → side panel: TWAIN scan failed or timed out (card pre-inserted / no card). */
export type TwainScanErrorBroadcast = {
  type: 'FDN_TWAIN_SCAN_ERROR'
  message: string
}
