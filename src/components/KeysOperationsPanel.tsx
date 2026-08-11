import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IdScanLogEntry, KeyBoardEntry, KeyLedgerEntry } from '../shared/protocol'
import { formatKeyHistoryShortYmdHm } from '../lib/key-board'
import { addLocalDays, clampDateRange, localDateString } from '../lib/local-date'
import { HistoryDateRangeControls } from './HistoryDateRangeControls'

type KeysOperationsPanelProps = {
  signedIn: boolean
  userRole: string | null
  hasManagerPin: boolean
  encoderConnected: boolean
  /** Emergency grant: front desk can Add guest + Move room without manager PIN. */
  frontDeskWriteGranted?: boolean
  /** Default checkout time ("HH:MM") and key duration (days) used to pre-fill Add guest. */
  defaultCheckoutTime?: string | null
  frontDeskDefaultKeyDays?: number
  frontDeskDefaultKeyDaysEnabled?: boolean
  onOpenIdScanEntry?: (entry: IdScanLogEntry) => void
}

type InnerTab = 'board' | 'history'

function compactNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
}

function defaultCheckoutCompact(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(12, 0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
}

function defaultCheckinLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T14:00`
}

function defaultCheckoutLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(12, 0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T12:00`
}

const ROOM_STATUS_LABELS: Record<string, string> = {
  occupied: 'Occupied',
  dirty: 'Dirty',
  in_service: 'In service',
  clean_ready: 'Clean ready',
  available: 'Available',
  out_of_order: 'Out of order',
}

function hkStatusLabel(status: string): string {
  return ROOM_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
}

function hkStatusBadgeClass(status: string): string {
  const base = 'fdn-keys-ops__hk-badge'
  switch (status) {
    case 'dirty':
      return `${base} fdn-keys-ops__hk-badge--dirty`
    case 'in_service':
      return `${base} fdn-keys-ops__hk-badge--in-service`
    case 'clean_ready':
      return `${base} fdn-keys-ops__hk-badge--clean-ready`
    case 'occupied':
      return `${base} fdn-keys-ops__hk-badge--occupied`
    case 'out_of_order':
      return `${base} fdn-keys-ops__hk-badge--out-of-order`
    default:
      return `${base} fdn-keys-ops__hk-badge--default`
  }
}

function vacantRowHkClass(status: string | null | undefined): string {
  switch (status) {
    case 'dirty':
      return ' fdn-keys-ops__row--hk-dirty'
    case 'in_service':
      return ' fdn-keys-ops__row--hk-in-service'
    case 'clean_ready':
      return ' fdn-keys-ops__row--hk-clean-ready'
    case 'occupied':
      return ' fdn-keys-ops__row--hk-occupied'
    case 'out_of_order':
      return ' fdn-keys-ops__row--hk-out-of-order'
    default:
      return ''
  }
}

function hhmmToHoursMinutes(hhmm: string | null | undefined): { h: number; m: number } {
  const m = (hhmm ?? '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return { h: 12, m: 0 }
  const h = Math.max(0, Math.min(23, Number.parseInt(m[1]!, 10)))
  const mm = Math.max(0, Math.min(59, Number.parseInt(m[2]!, 10)))
  return { h, m: mm }
}

function defaultCheckoutLocalFromSettings(
  days: number,
  defaultCheckoutTime: string | null | undefined,
): string {
  const d = new Date()
  d.setDate(d.getDate() + Math.max(1, Math.floor(days || 1)))
  const { h, m } = hhmmToHoursMinutes(defaultCheckoutTime)
  d.setHours(h, m, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function KeysOperationsPanel({
  signedIn,
  userRole,
  hasManagerPin,
  encoderConnected,
  frontDeskWriteGranted,
  defaultCheckoutTime,
  frontDeskDefaultKeyDays,
  frontDeskDefaultKeyDaysEnabled,
  onOpenIdScanEntry,
}: KeysOperationsPanelProps) {
  const today = useMemo(() => localDateString(), [])
  const isAdmin = userRole === 'admin'
  const isFrontDesk = userRole === 'front_desk'
  const hideForHousekeeper = userRole === 'housekeeper'

  const [innerTab, setInnerTab] = useState<InnerTab>('board')
  const [businessDate, setBusinessDate] = useState(today)
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [agentFilter, setAgentFilter] = useState('')
  const [roomFilter, setRoomFilter] = useState('')
  const [listSearch, setListSearch] = useState('')

  const [boardRows, setBoardRows] = useState<KeyBoardEntry[]>([])
  const [stats, setStats] = useState({ total: 0, withKey: 0, vacant: 0 })
  const [ledgerRows, setLedgerRows] = useState<KeyLedgerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null)
  const [profileJumpBusy, setProfileJumpBusy] = useState(false)

  // Admin/manager unlock state (non-front_desk roles)
  const [editUnlocked, setEditUnlocked] = useState(false)
  const [showPinEntry, setShowPinEntry] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [managerPinForWrite, setManagerPinForWrite] = useState<string | undefined>(undefined)

  const [blockBusy, setBlockBusy] = useState(false)
  const [encodeBusy, setEncodeBusy] = useState(false)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [showBlockForm, setShowBlockForm] = useState(false)
  const [blockHours, setBlockHours] = useState(4)
  const [blockReason, setBlockReason] = useState('')

  // Auto-dismiss ephemeral notices so stale warnings don't linger.
  useEffect(() => {
    if (!actionNotice) return
    const t = window.setTimeout(() => setActionNotice(null), 5 * 60 * 1000)
    return () => window.clearTimeout(t)
  }, [actionNotice])

  // Gated board actions (add guest, move room, remove guest) — manager PIN for front desk
  const [gatedAction, setGatedAction] = useState<'add' | 'move' | 'remove' | null>(null)
  const [gatedPinInput, setGatedPinInput] = useState('')
  const [gatedPinVerified, setGatedPinVerified] = useState(false)
  const [gatedPinBusy, setGatedPinBusy] = useState(false)
  const [gatedPinError, setGatedPinError] = useState<string | null>(null)
  const [gatedManagerPin, setGatedManagerPin] = useState('')
  const [moveTargetRoom, setMoveTargetRoom] = useState('')
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [guestActionBusy, setGuestActionBusy] = useState(false)
  const [addGuestName, setAddGuestName] = useState('')
  const [addGuestPhone, setAddGuestPhone] = useState('')
  const [addGuestCheckin, setAddGuestCheckin] = useState('')
  const [addGuestCheckout, setAddGuestCheckout] = useState('')

  const jumpDateRef = useRef<HTMLInputElement>(null)

  const canEdit = isAdmin || editUnlocked

  useEffect(() => {
    setEditUnlocked(false)
    setShowPinEntry(false)
    setPinInput('')
    setPinError(null)
    setManagerPinForWrite(undefined)
  }, [signedIn, userRole])

  // Reset gated actions when a different room is selected
  useEffect(() => {
    setGatedAction(null)
    setGatedPinInput('')
    setGatedPinVerified(false)
    setGatedPinError(null)
    setGatedManagerPin('')
    setMoveTargetRoom('')
    setConfirmingRemove(false)
    setAddGuestName('')
    setAddGuestPhone('')
    setAddGuestCheckin('')
    setAddGuestCheckout('')
    setActionNotice(null)
  }, [selectedRoom])

  const verifyPin = useCallback(async () => {
    const pin = pinInput.trim()
    if (!pin) return
    setPinBusy(true)
    setPinError(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'VERIFY_MANAGER_PIN',
        pin,
      })) as { ok: boolean; error?: string }
      if (!res.ok) {
        setPinError(res.error ?? 'Invalid PIN')
        return
      }
      setEditUnlocked(true)
      setManagerPinForWrite(pin)
      setShowPinEntry(false)
      setPinInput('')
    } catch (e) {
      setPinError(e instanceof Error ? e.message : 'Could not verify PIN')
    } finally {
      setPinBusy(false)
    }
  }, [pinInput])

  const loadBoard = useCallback(async () => {
    if (!signedIn) return
    setLoading(true)
    setError(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'GET_KEY_BOARD',
        businessDate,
        agentFilter: agentFilter.trim() || undefined,
      })) as {
        ok: boolean
        keyBoard?: KeyBoardEntry[]
        keyBoardStats?: { total: number; withKey: number; vacant: number }
        error?: string
      }
      if (!res.ok) {
        setBoardRows([])
        setError(res.error ?? 'Could not load room board')
        return
      }
      setBoardRows(res.keyBoard ?? [])
      if (res.keyBoardStats) setStats(res.keyBoardStats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load room board')
    } finally {
      setLoading(false)
    }
  }, [signedIn, businessDate, agentFilter])

  const loadLedger = useCallback(async () => {
    if (!signedIn) return
    setLoading(true)
    setError(null)
    try {
      const { from, to } = clampDateRange(fromDate, toDate)
      const res = (await chrome.runtime.sendMessage({
        type: 'GET_KEY_LEDGER',
        fromDate: from,
        toDate: to,
        agentFilter: agentFilter.trim() || undefined,
        roomFilter: roomFilter.trim() || undefined,
      })) as { ok: boolean; keyLedger?: KeyLedgerEntry[]; error?: string }
      if (!res.ok) {
        setLedgerRows([])
        setError(res.error ?? 'Could not load key history')
        return
      }
      setLedgerRows(res.keyLedger ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load key history')
    } finally {
      setLoading(false)
    }
  }, [signedIn, fromDate, toDate, agentFilter, roomFilter])

  useEffect(() => {
    if (!signedIn || hideForHousekeeper) return
    if (innerTab === 'board') void loadBoard()
    else void loadLedger()
  }, [signedIn, hideForHousekeeper, innerTab, loadBoard, loadLedger])

  const filteredBoard = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    if (!q) return boardRows
    return boardRows.filter((r) => {
      const hay = [r.roomNumber, r.guestName, r.confirmationNumber, r.encodedBy]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [boardRows, listSearch])

  const filteredLedger = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    if (!q) return ledgerRows
    return ledgerRows.filter((r) => {
      const hay = [r.roomNumber, r.guestName, r.confirmationNumber, r.encodedBy]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [ledgerRows, listSearch])

  useEffect(() => {
    if (!filteredBoard.length) {
      setSelectedRoom(null)
      return
    }
    if (!selectedRoom || !filteredBoard.some((r) => r.roomNumber === selectedRoom)) {
      setSelectedRoom(filteredBoard[0]!.roomNumber)
    }
  }, [filteredBoard, selectedRoom])

  const selected = useMemo(
    () => filteredBoard.find((r) => r.roomNumber === selectedRoom) ?? null,
    [filteredBoard, selectedRoom],
  )

  const jumpToLatestIdProfile = useCallback(async (confirmationNumber: string | null | undefined) => {
    const conf = confirmationNumber?.trim()
    if (!conf) return
    if (!onOpenIdScanEntry) return
    setProfileJumpBusy(true)
    setActionNotice(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'GET_LATEST_ID_SCAN_FOR_CONFIRMATION',
        confirmationNumber: conf,
      })) as { ok?: boolean; idScanLog?: IdScanLogEntry[]; error?: string }
      const entry = res.ok ? (res.idScanLog?.[0] ?? null) : null
      if (!entry) {
        setActionNotice('No ID profile linked to this guest yet.')
        return
      }
      onOpenIdScanEntry(entry)
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : 'Could not open guest profile.')
    } finally {
      setProfileJumpBusy(false)
    }
  }, [onOpenIdScanEntry])

  const vacantTargetRooms = useMemo(
    () =>
      boardRows
        .filter(
          (r) =>
            r.roomNumber !== selected?.roomNumber &&
            !r.hasKey &&
            !r.blocked &&
            (r.roomStatus === 'available' || r.roomStatus == null),
        )
        .map((r) => r.roomNumber),
    [boardRows, selected?.roomNumber],
  )

  const writePin = isAdmin ? undefined : managerPinForWrite

  const needsActionPin = isFrontDesk && !frontDeskWriteGranted
  const actionPinReady = !needsActionPin || gatedPinVerified

  const verifyGatedPin = useCallback(async () => {
    const pin = gatedPinInput.trim()
    if (!pin) return
    setGatedPinBusy(true)
    setGatedPinError(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'VERIFY_MANAGER_PIN',
        pin,
      })) as { ok: boolean; error?: string }
      if (!res.ok) {
        setGatedPinError(res.error ?? 'Invalid PIN')
        return
      }
      setGatedPinVerified(true)
      setGatedManagerPin(pin)
      setGatedPinInput('')
      if (gatedAction === 'add') {
        setAddGuestCheckin(defaultCheckinLocal())
        if (frontDeskDefaultKeyDaysEnabled !== false) {
          setAddGuestCheckout(
            defaultCheckoutLocalFromSettings(
              frontDeskDefaultKeyDays ?? 1,
              defaultCheckoutTime ?? null,
            ),
          )
        } else {
          setAddGuestCheckout(defaultCheckoutLocal())
        }
      }
    } catch (e) {
      setGatedPinError(e instanceof Error ? e.message : 'Could not verify PIN')
    } finally {
      setGatedPinBusy(false)
    }
  }, [gatedPinInput, gatedAction, frontDeskDefaultKeyDaysEnabled, frontDeskDefaultKeyDays, defaultCheckoutTime])

  const resolveActionPin = useCallback((): string | undefined => {
    if (isAdmin) return undefined
    if (canEdit) return writePin
    if (gatedPinVerified) return gatedManagerPin
    return undefined
  }, [isAdmin, canEdit, writePin, gatedPinVerified, gatedManagerPin])

  const startGatedAction = useCallback(
    (action: 'add' | 'move' | 'remove') => {
      setGatedAction(action)
      setGatedPinError(null)
      setConfirmingRemove(false)
      if (!needsActionPin) {
        setGatedPinVerified(true)
        if (action === 'add') {
          setAddGuestCheckin(defaultCheckinLocal())
          if (frontDeskDefaultKeyDaysEnabled !== false) {
            setAddGuestCheckout(
              defaultCheckoutLocalFromSettings(
                frontDeskDefaultKeyDays ?? 1,
                defaultCheckoutTime ?? null,
              ),
            )
          } else {
            setAddGuestCheckout(defaultCheckoutLocal())
          }
        }
      } else {
        setGatedPinVerified(false)
        setGatedManagerPin('')
      }
    },
    [needsActionPin, frontDeskDefaultKeyDaysEnabled, frontDeskDefaultKeyDays, defaultCheckoutTime],
  )

  const cancelGatedAction = useCallback(() => {
    setGatedAction(null)
    setGatedPinInput('')
    setGatedPinVerified(false)
    setGatedPinError(null)
    setGatedManagerPin('')
    setMoveTargetRoom('')
    setConfirmingRemove(false)
    setAddGuestName('')
    setAddGuestPhone('')
    setAddGuestCheckin('')
    setAddGuestCheckout('')
  }, [])

  const handleBlock = useCallback(async () => {
    if (!selected || !canEdit) return
    setBlockBusy(true)
    setActionNotice(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'CREATE_ROOM_BLOCK',
        roomNumber: selected.roomNumber,
        durationKind: 'hours',
        durationValue: blockHours,
        reason: blockReason.trim() || undefined,
        effectiveFromVacancy: Boolean(selected.hasKey),
        managerPin: writePin,
      })) as { ok: boolean; error?: string }
      if (!res.ok) {
        setActionNotice(res.error ?? 'Block failed')
        return
      }
      setShowBlockForm(false)
      setBlockReason('')
      setActionNotice(`Room ${selected.roomNumber} blocked.`)
      void loadBoard()
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : 'Block failed')
    } finally {
      setBlockBusy(false)
    }
  }, [selected, canEdit, blockHours, blockReason, writePin, loadBoard])

  const handleUnblock = useCallback(async () => {
    if (!selected?.blockId || !canEdit) return
    setBlockBusy(true)
    setActionNotice(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'RELEASE_ROOM_BLOCK',
        blockId: selected.blockId,
        roomNumber: selected.roomNumber,
        managerPin: writePin,
      })) as { ok: boolean; error?: string }
      if (!res.ok) {
        setActionNotice(res.error ?? 'Unblock failed')
        return
      }
      setActionNotice(`Room ${selected.roomNumber} unblocked.`)
      void loadBoard()
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : 'Unblock failed')
    } finally {
      setBlockBusy(false)
    }
  }, [selected, canEdit, writePin, loadBoard])

  const handleEncode = useCallback(async () => {
    if (!selected || !canEdit || !encoderConnected) return
    setEncodeBusy(true)
    setActionNotice(null)
    const conf =
      selected.confirmationNumber?.trim() ||
      `WALK-${selected.roomNumber}-${Date.now().toString(36).toUpperCase()}`
    const checkin = selected.checkinTime?.trim() || compactNow()
    const checkout = selected.checkoutTime?.trim() || defaultCheckoutCompact()
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'KEYS_ADMIN_ENCODE',
        roomNumber: selected.roomNumber,
        checkinTime: checkin,
        checkoutTime: checkout,
        confirmationNumber: conf,
        guestName: selected.guestName,
        cardSerial: Math.max(1, (selected.cardSerial ?? 0) + 1),
        managerPin: writePin,
      })) as { ok: boolean; error?: string; dbWarning?: string }
      if (!res.ok) {
        setActionNotice(res.error ?? 'Encode failed')
        return
      }
      setActionNotice(`Key encoded for room ${selected.roomNumber}.`)
      void loadBoard()
      if (innerTab === 'history') void loadLedger()
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : 'Encode failed')
    } finally {
      setEncodeBusy(false)
    }
  }, [selected, canEdit, encoderConnected, writePin, loadBoard, loadLedger, innerTab])

  // Front desk: re-encode key for an occupied room (no manager PIN required)
  const handleFrontDeskRemake = useCallback(async () => {
    if (!selected || !encoderConnected) return
    setEncodeBusy(true)
    setActionNotice(null)
    const conf =
      selected.confirmationNumber?.trim() ||
      `WALK-${selected.roomNumber}-${Date.now().toString(36).toUpperCase()}`
    const checkin = selected.checkinTime?.trim() || compactNow()
    const checkout = selected.checkoutTime?.trim() || defaultCheckoutCompact()
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'KEYS_ADMIN_ENCODE',
        roomNumber: selected.roomNumber,
        checkinTime: checkin,
        checkoutTime: checkout,
        confirmationNumber: conf,
        guestName: selected.guestName,
        cardSerial: Math.max(1, (selected.cardSerial ?? 0) + 1),
        frontDeskOccupied: true,
      })) as { ok: boolean; error?: string }
      if (!res.ok) {
        setActionNotice(res.error ?? 'Encode failed')
        return
      }
      setActionNotice(`Key encoded for room ${selected.roomNumber}.`)
      void loadBoard()
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : 'Encode failed')
    } finally {
      setEncodeBusy(false)
    }
  }, [selected, encoderConnected, loadBoard])

  // Front desk: encode a manual key for a vacant room (manager PIN + form)
  const handleAddGuest = useCallback(async () => {
    if (
      !selected ||
      !encoderConnected ||
      !actionPinReady ||
      !addGuestName.trim() ||
      !addGuestCheckin ||
      !addGuestCheckout
    ) {
      return
    }
    setGuestActionBusy(true)
    setActionNotice(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'KEYS_ADD_GUEST',
        roomNumber: selected.roomNumber,
        checkinTime: addGuestCheckin,
        checkoutTime: addGuestCheckout,
        guestName: addGuestName.trim(),
        phone: addGuestPhone.trim() || undefined,
        managerPin: resolveActionPin(),
      })) as { ok: boolean; error?: string; dbWarning?: string }
      if (!res.ok) {
        setActionNotice(res.error ?? 'Add guest failed')
        return
      }
      setActionNotice(`Guest added and key encoded for room ${selected.roomNumber}.`)
      cancelGatedAction()
      void loadBoard()
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : 'Add guest failed')
    } finally {
      setGuestActionBusy(false)
    }
  }, [
    selected,
    encoderConnected,
    actionPinReady,
    addGuestName,
    addGuestCheckin,
    addGuestCheckout,
    addGuestPhone,
    resolveActionPin,
    cancelGatedAction,
    loadBoard,
  ])

  const handleMoveRoom = useCallback(async () => {
    if (
      !selected?.hasKey ||
      !selected.confirmationNumber ||
      !moveTargetRoom.trim() ||
      !encoderConnected ||
      !actionPinReady
    ) {
      return
    }
    const checkin = selected.checkinTime?.trim() || compactNow()
    const checkout = selected.checkoutTime?.trim() || defaultCheckoutCompact()
    setGuestActionBusy(true)
    setActionNotice(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'KEYS_MOVE_ROOM',
        fromRoom: selected.roomNumber,
        toRoom: moveTargetRoom.trim(),
        confirmationNumber: selected.confirmationNumber,
        guestName: selected.guestName,
        checkinTime: checkin,
        checkoutTime: checkout,
        managerPin: resolveActionPin(),
      })) as { ok: boolean; error?: string; keyReminder?: string; movedToRoom?: string }
      if (!res.ok) {
        setActionNotice(res.error ?? 'Move room failed')
        return
      }
      const notice = res.keyReminder
        ? `Moved to room ${moveTargetRoom.trim()} and key encoded. ${res.keyReminder}`
        : `Moved to room ${moveTargetRoom.trim()} and key encoded.`
      setActionNotice(notice)
      cancelGatedAction()
      setSelectedRoom(res.movedToRoom ?? moveTargetRoom.trim())
      void loadBoard()
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : 'Move room failed')
    } finally {
      setGuestActionBusy(false)
    }
  }, [
    selected,
    moveTargetRoom,
    encoderConnected,
    actionPinReady,
    resolveActionPin,
    cancelGatedAction,
    loadBoard,
  ])

  const handleRemoveGuest = useCallback(async () => {
    if (!selected?.hasKey || !selected.confirmationNumber || !actionPinReady) return
    setGuestActionBusy(true)
    setActionNotice(null)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'KEYS_REMOVE_GUEST',
        roomNumber: selected.roomNumber,
        confirmationNumber: selected.confirmationNumber,
        guestName: selected.guestName,
        managerPin: resolveActionPin(),
      })) as { ok: boolean; error?: string; keyReminder?: string }
      if (!res.ok) {
        setActionNotice(res.error ?? 'Remove guest failed')
        return
      }
      const notice = res.keyReminder
        ? `Guest removed from room ${selected.roomNumber}. ${res.keyReminder}`
        : `Guest removed from room ${selected.roomNumber}.`
      setActionNotice(notice)
      cancelGatedAction()
      void loadBoard()
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : 'Remove guest failed')
    } finally {
      setGuestActionBusy(false)
      setConfirmingRemove(false)
    }
  }, [selected, actionPinReady, resolveActionPin, cancelGatedAction, loadBoard])

  const handleExportCsv = useCallback(() => {
    if (!canEdit || filteredLedger.length === 0) return
    const header = ['Encoded', 'Room', 'Guest', 'Confirmation', 'Card #', 'In', 'Out', 'Agent']
    const csvRows = [
      header,
      ...filteredLedger.map((r) => [
        r.encodedAt,
        r.roomNumber,
        r.guestName ?? '',
        r.confirmationNumber,
        r.cardSerial ?? '',
        r.checkinTime ?? '',
        r.checkoutTime ?? '',
        r.encodedBy ?? '',
      ]),
    ]
    const csv = csvRows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `key_ledger_${fromDate}_to_${toDate}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  }, [canEdit, filteredLedger, fromDate, toDate])

  if (!signedIn) {
    return (
      <section className="fdn-panel fdn-panel--keys-ops">
        <p className="fdn-muted">Sign in to view Keys.</p>
      </section>
    )
  }

  if (hideForHousekeeper) {
    return (
      <section className="fdn-panel fdn-panel--keys-ops">
        <p className="fdn-muted">Keys board is not available for your role.</p>
      </section>
    )
  }

  return (
    <section className="fdn-panel fdn-panel--keys-ops" aria-label="Keys operations">
      <div className="fdn-keys-ops__toolbar">
        <div className="fdn-id-log__toolbar-head">
          <h2 className="fdn-id-log__title">Keys</h2>
          <p className="fdn-id-log__subtitle">
            {innerTab === 'history' ? 'Daily encode log by date range' : 'Room board and encode ledger'}
          </p>
        </div>

        {!isAdmin && !canEdit && !isFrontDesk ? (
          <div className="fdn-sig-log__unlock">
            <p className="fdn-sig-log__unlock-text">
              View only. Manager PIN required to block rooms or encode from the board.
            </p>
            {hasManagerPin ? (
              showPinEntry ? (
                <div className="fdn-sig-log__pin-row">
                  <input
                    type="password"
                    className="fdn-input fdn-sig-log__pin-input"
                    placeholder="Manager PIN"
                    value={pinInput}
                    autoFocus
                    onChange={(e) => setPinInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void verifyPin()
                    }}
                  />
                  <button
                    type="button"
                    className="fdn-btn fdn-btn--primary fdn-btn--xs"
                    disabled={!pinInput.trim() || pinBusy}
                    onClick={() => void verifyPin()}
                  >
                    {pinBusy ? '…' : 'Unlock'}
                  </button>
                  <button
                    type="button"
                    className="fdn-btn fdn-btn--secondary fdn-btn--xs"
                    onClick={() => {
                      setShowPinEntry(false)
                      setPinInput('')
                      setPinError(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="fdn-btn fdn-btn--secondary fdn-btn--xs"
                  onClick={() => {
                    setShowPinEntry(true)
                    setPinError(null)
                  }}
                >
                  Enter manager PIN
                </button>
              )
            ) : (
              <p className="fdn-muted fdn-sig-log__unlock-hint">No manager PIN configured.</p>
            )}
            {pinError ? (
              <p className="fdn-form-error fdn-sig-log__pin-error" role="alert">
                {pinError}
              </p>
            ) : null}
          </div>
        ) : isAdmin ? (
          <p className="fdn-sig-log__role-badge fdn-sig-log__role-badge--admin">Admin — full access</p>
        ) : isFrontDesk ? (
          <p className="fdn-sig-log__role-badge">Front Desk — select a room to encode</p>
        ) : (
          <p className="fdn-sig-log__role-badge">Unlocked — edits enabled</p>
        )}

        <div className="fdn-keys-ops__subtabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={innerTab === 'board'}
            className={
              innerTab === 'board' ? 'fdn-keys-ops__subtab fdn-keys-ops__subtab--active' : 'fdn-keys-ops__subtab'
            }
            onClick={() => setInnerTab('board')}
          >
            Room board
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={innerTab === 'history'}
            className={
              innerTab === 'history'
                ? 'fdn-keys-ops__subtab fdn-keys-ops__subtab--active'
                : 'fdn-keys-ops__subtab'
            }
            onClick={() => setInnerTab('history')}
          >
            Key history
          </button>
        </div>

        <label className="fdn-id-log__search">
          <span className="fdn-sr-only">Search</span>
          <input
            className="fdn-input fdn-id-log__search-input"
            type="text"
            role="searchbox"
            placeholder="Room, guest, confirmation…"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
          />
          {listSearch.trim() ? (
            <button
              type="button"
              className="fdn-btn fdn-btn--ghost fdn-btn--xs fdn-id-log__search-clear"
              onClick={() => setListSearch('')}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </label>

        {innerTab === 'board' ? (
          <>
            <div className="fdn-id-log__date-nav" role="group" aria-label="Business date">
              <button
                type="button"
                className="fdn-id-log__nav-btn"
                aria-label="Previous day"
                onClick={() => setBusinessDate((d) => addLocalDays(d, -1))}
              >
                ‹
              </button>
              <div className="fdn-id-log__date-display">
                <span className="fdn-id-log__date-label">{businessDate}</span>
                <button
                  type="button"
                  className="fdn-id-log__date-jump"
                  aria-label="Jump to date"
                  onClick={() => jumpDateRef.current?.showPicker?.() ?? jumpDateRef.current?.click()}
                >
                  📅
                </button>
                <input
                  ref={jumpDateRef}
                  className="fdn-id-log__date-jump-input"
                  type="date"
                  value={businessDate}
                  max={today}
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => setBusinessDate(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="fdn-id-log__nav-btn"
                aria-label="Next day"
                disabled={businessDate >= today}
                onClick={() => setBusinessDate((d) => addLocalDays(d, 1))}
              >
                ›
              </button>
              <button
                type="button"
                className="fdn-id-log__nav-btn fdn-keys-ops__today"
                onClick={() => setBusinessDate(today)}
              >
                Today
              </button>
            </div>
            <div className="fdn-id-log__filters">
              <label className="fdn-label fdn-label--compact">
                <span className="fdn-label__text">Agent</span>
                <input
                  className="fdn-input"
                  type="text"
                  placeholder="Filter…"
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="fdn-btn fdn-btn--secondary fdn-btn--xs fdn-id-log__reload"
                disabled={loading}
                onClick={() => void loadBoard()}
              >
                {loading ? 'Loading…' : 'Reload'}
              </button>
              {canEdit ? (
                <>
                  <button
                    type="button"
                    className="fdn-btn fdn-btn--primary fdn-btn--xs"
                    disabled={!selected || encodeBusy || !encoderConnected}
                    title={
                      !selected
                        ? 'Select a room first'
                        : !encoderConnected
                          ? 'Connect RFID encoder'
                          : 'Encode key for selected room'
                    }
                    onClick={() => void handleEncode()}
                  >
                    {encodeBusy ? '…' : 'Encode key'}
                  </button>
                  {selected?.blocked && selected.blockId ? (
                    <button
                      type="button"
                      className="fdn-btn fdn-btn--secondary fdn-btn--xs"
                      disabled={!selected || blockBusy}
                      onClick={() => void handleUnblock()}
                    >
                      {blockBusy ? '…' : 'Unblock'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="fdn-btn fdn-btn--secondary fdn-btn--xs"
                      disabled={!selected || blockBusy}
                      onClick={() => setShowBlockForm((v) => !v)}
                    >
                      Block room
                    </button>
                  )}
                </>
              ) : null}
            </div>
            <p className="fdn-id-log__count">
              {loading
                ? 'Loading…'
                : `${filteredBoard.length} rooms · ${stats.withKey} with key · ${stats.vacant} vacant`}
            </p>
          </>
        ) : (
          <>
            <HistoryDateRangeControls
              fromDate={fromDate}
              toDate={toDate}
              today={today}
              onFromDateChange={setFromDate}
              onToDateChange={setToDate}
              agentFilter={agentFilter}
              onAgentFilterChange={setAgentFilter}
              roomFilter={roomFilter}
              onRoomFilterChange={setRoomFilter}
              loading={loading}
              onReload={() => void loadLedger()}
            >
              <button
                type="button"
                className="fdn-btn fdn-btn--secondary fdn-btn--xs"
                disabled={!canEdit || filteredLedger.length === 0}
                onClick={handleExportCsv}
              >
                Export CSV
              </button>
            </HistoryDateRangeControls>
            <p className="fdn-id-log__count">
              {loading
                ? 'Loading encodes…'
                : `${filteredLedger.length} of ${ledgerRows.length} encode${
                    ledgerRows.length !== 1 ? 's' : ''
                  }${roomFilter.trim() || agentFilter.trim() ? ' (filtered)' : ''}`}
            </p>
          </>
        )}
      </div>

      {(error || actionNotice) && (
        <div
          className={error ? 'fdn-form-error' : 'fdn-banner fdn-banner--info'}
          role={error ? 'alert' : undefined}
          style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}
        >
          <span style={{ flex: '1 1 auto' }}>{error ?? actionNotice}</span>
          {!error && actionNotice ? (
            <button
              type="button"
              className="fdn-btn fdn-btn--secondary fdn-btn--xs"
              onClick={() => setActionNotice(null)}
              title="Clear this message"
              style={{ flex: '0 0 auto' }}
            >
              Clear
            </button>
          ) : null}
        </div>
      )}

      {innerTab === 'board' ? (
        <div className="fdn-keys-ops__body">
          <div className="fdn-keys-ops__list-wrap">
            {loading && filteredBoard.length === 0 ? (
              <p className="fdn-muted fdn-id-log__empty">Loading room board…</p>
            ) : filteredBoard.length === 0 ? (
              <p className="fdn-muted fdn-id-log__empty">No rooms configured.</p>
            ) : (
              <table className="fdn-table fdn-table--compact fdn-id-log__table">
                <thead>
                  <tr>
                    <th>Rm</th>
                    <th>Guest</th>
                    <th>In</th>
                    <th>Out</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBoard.map((r) => (
                    <tr
                      key={r.roomNumber}
                      className={
                        selectedRoom === r.roomNumber
                          ? `fdn-id-log__row--active fdn-keys-ops__row${r.blocked ? ' fdn-keys-ops__row--blocked' : ''}${!r.hasKey ? ` fdn-keys-ops__row--vacant${vacantRowHkClass(r.roomStatus)}` : ''}`
                          : `fdn-id-log__row fdn-keys-ops__row${r.blocked ? ' fdn-keys-ops__row--blocked' : ''}${!r.hasKey ? ` fdn-keys-ops__row--vacant${vacantRowHkClass(r.roomStatus)}` : ''}`
                      }
                      onClick={() => setSelectedRoom(r.roomNumber)}
                    >
                      <td className="fdn-mono fdn-keys-ops__cell-rm">
                        <span>{r.roomNumber}</span>
                        {r.blocked ? (
                          <span className="fdn-keys-ops__badge" title={r.blockSummary ?? ''}>
                            Block
                          </span>
                        ) : null}
                        {!r.hasKey && r.roomStatus && r.roomStatus !== 'available' ? (
                          <span className={hkStatusBadgeClass(r.roomStatus)} title={hkStatusLabel(r.roomStatus)}>
                            {hkStatusLabel(r.roomStatus)}
                          </span>
                        ) : null}
                      </td>
                      <td className="fdn-id-log__cell-guest" title={r.guestName ?? ''}>
                        {r.guestName ?? '—'}
                      </td>
                      <td className="fdn-id-log__cell-when">
                        {formatKeyHistoryShortYmdHm(r.checkinTime) ?? '—'}
                      </td>
                      <td className="fdn-id-log__cell-when">
                        {formatKeyHistoryShortYmdHm(r.checkoutTime) ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="fdn-keys-ops__detail">
            {!selected ? (
              <p className="fdn-muted">Select a room.</p>
            ) : (
              <>
                <h3 className="fdn-keys-ops__detail-title">Room {selected.roomNumber}</h3>
                <dl className="fdn-dl fdn-dl--compact">
                  <dt>Guest</dt>
                  <dd>
                    {selected.confirmationNumber && selected.hasKey && onOpenIdScanEntry ? (
                      <button
                        type="button"
                        className="fdn-btn fdn-btn--link"
                        disabled={profileJumpBusy}
                        title="Open the latest ID scan profile for this guest"
                        onClick={() => void jumpToLatestIdProfile(selected.confirmationNumber)}
                        style={{ padding: 0, fontSize: 12, textDecoration: 'underline' }}
                      >
                        {selected.guestName ?? 'Vacant'}
                      </button>
                    ) : (
                      <span>{selected.guestName ?? 'Vacant'}</span>
                    )}
                  </dd>
                  <dt>Confirmation</dt>
                  <dd className="fdn-mono">{selected.confirmationNumber ?? '—'}</dd>
                  <dt>Agent</dt>
                  <dd>{selected.encodedBy ?? '—'}</dd>
                  {selected.roomStatus ? (
                    <>
                      <dt>HK status</dt>
                      <dd>
                        <span className={hkStatusBadgeClass(selected.roomStatus)}>
                          {hkStatusLabel(selected.roomStatus)}
                        </span>
                      </dd>
                    </>
                  ) : null}
                  {selected.blockSummary ? (
                    <>
                      <dt>Block</dt>
                      <dd>{selected.blockSummary}</dd>
                    </>
                  ) : null}
                </dl>

                {showBlockForm && canEdit && !selected.blocked ? (
                  <div className="fdn-keys-ops__block-form">
                    <label className="fdn-label fdn-label--compact">
                      <span className="fdn-label__text">Hours</span>
                      <input
                        className="fdn-input"
                        type="number"
                        min={1}
                        max={168}
                        value={blockHours}
                        onChange={(e) => setBlockHours(Number(e.target.value) || 4)}
                      />
                    </label>
                    <label className="fdn-label fdn-label--compact">
                      <span className="fdn-label__text">Reason</span>
                      <input
                        className="fdn-input"
                        type="text"
                        value={blockReason}
                        onChange={(e) => setBlockReason(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="fdn-btn fdn-btn--danger fdn-btn--xs"
                      disabled={blockBusy}
                      onClick={() => void handleBlock()}
                    >
                      {blockBusy ? '…' : 'Confirm block'}
                    </button>
                  </div>
                ) : null}

                {/* Board guest actions */}
                {selected.hasKey && (isFrontDesk || canEdit) ? (
                  <div className="fdn-keys-ops__guest-actions" style={{ marginTop: 10 }}>
                    {isFrontDesk ? (
                      <>
                        <button
                          type="button"
                          className="fdn-btn fdn-btn--primary fdn-btn--xs"
                          disabled={encodeBusy || !encoderConnected}
                          title={!encoderConnected ? 'Connect RFID encoder' : 'Re-encode key using existing stay dates'}
                          onClick={() => void handleFrontDeskRemake()}
                        >
                          {encodeBusy ? 'Encoding…' : 'Encode key'}
                        </button>
                        <p className="fdn-help" style={{ marginTop: 4 }}>
                          Re-encodes using check-in/out from the board. To change dates, update in the PMS first.
                        </p>
                      </>
                    ) : null}

                    {!gatedAction ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: isFrontDesk ? 8 : 0 }}>
                        <button
                          type="button"
                          className="fdn-btn fdn-btn--secondary fdn-btn--xs"
                          disabled={guestActionBusy || vacantTargetRooms.length === 0}
                          title={vacantTargetRooms.length === 0 ? 'No vacant rooms available' : 'Move guest to another room'}
                          onClick={() => startGatedAction('move')}
                        >
                          Move room
                        </button>
                        <button
                          type="button"
                          className="fdn-btn fdn-btn--danger fdn-btn--xs"
                          disabled={guestActionBusy || !selected.confirmationNumber}
                          onClick={() => startGatedAction('remove')}
                        >
                          Remove guest
                        </button>
                      </div>
                    ) : null}

                    {gatedAction === 'move' ? (
                      <div style={{ marginTop: 8 }}>
                        {needsActionPin && !gatedPinVerified ? (
                          <div>
                            <p className="fdn-help" style={{ marginBottom: 6 }}>
                              Manager PIN required to move a guest.
                            </p>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              <input
                                type="password"
                                className="fdn-input"
                                placeholder="Manager PIN"
                                style={{ fontSize: 12, width: 120 }}
                                value={gatedPinInput}
                                autoFocus
                                onChange={(e) => setGatedPinInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void verifyGatedPin() }}
                              />
                              <button
                                type="button"
                                className="fdn-btn fdn-btn--primary fdn-btn--xs"
                                disabled={!gatedPinInput.trim() || gatedPinBusy}
                                onClick={() => void verifyGatedPin()}
                              >
                                {gatedPinBusy ? '…' : 'Unlock'}
                              </button>
                              <button type="button" className="fdn-btn fdn-btn--secondary fdn-btn--xs" onClick={cancelGatedAction}>
                                Cancel
                              </button>
                            </div>
                            {gatedPinError ? (
                              <p style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>{gatedPinError}</p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="fdn-keys-ops__block-form">
                            <label className="fdn-label fdn-label--compact">
                              <span className="fdn-label__text">New room *</span>
                              <select
                                className="fdn-input"
                                value={moveTargetRoom}
                                onChange={(e) => setMoveTargetRoom(e.target.value)}
                              >
                                <option value="">Select room…</option>
                                {vacantTargetRooms.map((rn) => (
                                  <option key={rn} value={rn}>{rn}</option>
                                ))}
                              </select>
                            </label>
                            <p className="fdn-help">
                              Original check-in is kept. One key will be encoded for the new room.
                            </p>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="fdn-btn fdn-btn--primary fdn-btn--xs"
                                disabled={guestActionBusy || !encoderConnected || !moveTargetRoom.trim()}
                                onClick={() => void handleMoveRoom()}
                              >
                                {guestActionBusy ? 'Moving…' : 'Confirm move'}
                              </button>
                              <button type="button" className="fdn-btn fdn-btn--secondary fdn-btn--xs" onClick={cancelGatedAction}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {gatedAction === 'remove' ? (
                      <div style={{ marginTop: 8 }}>
                        {needsActionPin && !gatedPinVerified ? (
                          <div>
                            <p className="fdn-help" style={{ marginBottom: 6 }}>
                              Manager PIN required to remove a guest.
                            </p>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              <input
                                type="password"
                                className="fdn-input"
                                placeholder="Manager PIN"
                                style={{ fontSize: 12, width: 120 }}
                                value={gatedPinInput}
                                autoFocus
                                onChange={(e) => setGatedPinInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void verifyGatedPin() }}
                              />
                              <button
                                type="button"
                                className="fdn-btn fdn-btn--primary fdn-btn--xs"
                                disabled={!gatedPinInput.trim() || gatedPinBusy}
                                onClick={() => void verifyGatedPin()}
                              >
                                {gatedPinBusy ? '…' : 'Unlock'}
                              </button>
                              <button type="button" className="fdn-btn fdn-btn--secondary fdn-btn--xs" onClick={cancelGatedAction}>
                                Cancel
                              </button>
                            </div>
                            {gatedPinError ? (
                              <p style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>{gatedPinError}</p>
                            ) : null}
                          </div>
                        ) : confirmingRemove ? (
                          <div>
                            <p className="fdn-help">
                              Remove guest from room {selected.roomNumber}? The room will show vacant on the board.
                            </p>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                              <button
                                type="button"
                                className="fdn-btn fdn-btn--danger fdn-btn--xs"
                                disabled={guestActionBusy}
                                onClick={() => void handleRemoveGuest()}
                              >
                                {guestActionBusy ? 'Removing…' : 'Yes, remove guest'}
                              </button>
                              <button
                                type="button"
                                className="fdn-btn fdn-btn--secondary fdn-btn--xs"
                                disabled={guestActionBusy}
                                onClick={() => setConfirmingRemove(false)}
                              >
                                Keep guest
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="fdn-btn fdn-btn--danger fdn-btn--xs"
                            onClick={() => setConfirmingRemove(true)}
                          >
                            Confirm remove guest
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {!selected.hasKey && (isFrontDesk || canEdit) ? (
                  <div style={{ marginTop: 10 }}>
                    {!gatedAction ? (
                      <button
                        type="button"
                        className="fdn-btn fdn-btn--secondary fdn-btn--xs"
                        onClick={() => startGatedAction('add')}
                      >
                        Add guest
                      </button>
                    ) : gatedAction === 'add' ? (
                      needsActionPin && !gatedPinVerified ? (
                        <div>
                          <p className="fdn-help" style={{ marginBottom: 6 }}>
                            Manager PIN required to add a guest to a vacant room.
                          </p>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <input
                              type="password"
                              className="fdn-input"
                              placeholder="Manager PIN"
                              style={{ fontSize: 12, width: 120 }}
                              value={gatedPinInput}
                              autoFocus
                              onChange={(e) => setGatedPinInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void verifyGatedPin() }}
                            />
                            <button
                              type="button"
                              className="fdn-btn fdn-btn--primary fdn-btn--xs"
                              disabled={!gatedPinInput.trim() || gatedPinBusy}
                              onClick={() => void verifyGatedPin()}
                            >
                              {gatedPinBusy ? '…' : 'Unlock'}
                            </button>
                            <button type="button" className="fdn-btn fdn-btn--secondary fdn-btn--xs" onClick={cancelGatedAction}>
                              Cancel
                            </button>
                          </div>
                          {gatedPinError ? (
                            <p style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>{gatedPinError}</p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="fdn-keys-ops__block-form">
                          <label className="fdn-label fdn-label--compact">
                            <span className="fdn-label__text">Guest name *</span>
                            <input
                              className="fdn-input"
                              type="text"
                              value={addGuestName}
                              placeholder="LAST, First"
                              onChange={(e) => setAddGuestName(e.target.value)}
                            />
                          </label>
                          <label className="fdn-label fdn-label--compact">
                            <span className="fdn-label__text">Check-in *</span>
                            <input
                              className="fdn-input"
                              type="datetime-local"
                              value={addGuestCheckin}
                              onChange={(e) => setAddGuestCheckin(e.target.value)}
                            />
                          </label>
                          <label className="fdn-label fdn-label--compact">
                            <span className="fdn-label__text">Check-out *</span>
                            <input
                              className="fdn-input"
                              type="datetime-local"
                              value={addGuestCheckout}
                              onChange={(e) => setAddGuestCheckout(e.target.value)}
                            />
                          </label>
                          <label className="fdn-label fdn-label--compact">
                            <span className="fdn-label__text">Phone</span>
                            <input
                              className="fdn-input"
                              type="tel"
                              value={addGuestPhone}
                              placeholder="Optional"
                              onChange={(e) => setAddGuestPhone(e.target.value)}
                            />
                          </label>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="fdn-btn fdn-btn--primary fdn-btn--xs"
                              disabled={
                                guestActionBusy ||
                                !encoderConnected ||
                                !addGuestName.trim() ||
                                !addGuestCheckin ||
                                !addGuestCheckout
                              }
                              onClick={() => void handleAddGuest()}
                            >
                              {guestActionBusy ? 'Adding…' : 'Add guest & encode key'}
                            </button>
                            <button type="button" className="fdn-btn fdn-btn--secondary fdn-btn--xs" onClick={cancelGatedAction}>
                              Cancel
                            </button>
                          </div>
                          {!encoderConnected ? (
                            <p className="fdn-muted" style={{ marginTop: 4, fontSize: 11 }}>Encoder offline — connect USB.</p>
                          ) : null}
                        </div>
                      )
                    ) : null}
                  </div>
                ) : null}

                {!encoderConnected && canEdit ? (
                  <p className="fdn-muted fdn-keys-ops__hint">Encoder offline — connect USB to encode.</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="fdn-id-log__body">
          <div className="fdn-id-log__list-wrap">
          {loading && filteredLedger.length === 0 ? (
            <p className="fdn-muted fdn-id-log__empty">Loading key encodes…</p>
          ) : filteredLedger.length === 0 ? (
            <p className="fdn-muted fdn-id-log__empty">No encodes match these filters.</p>
          ) : (
            <table className="fdn-table fdn-table--compact fdn-id-log__table">
              <thead>
                <tr>
                  <th>Rm</th>
                  <th>Guest</th>
                  <th>Signed</th>
                  <th>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedger.map((r) => (
                  <tr key={r.id} className="fdn-id-log__row">
                    <td className="fdn-mono">{r.roomNumber}</td>
                    <td className="fdn-id-log__cell-guest">
                      {onOpenIdScanEntry ? (
                        <button
                          type="button"
                          className="fdn-btn fdn-btn--link"
                          disabled={profileJumpBusy || !r.confirmationNumber?.trim()}
                          title="Open the latest ID scan profile for this guest"
                          onClick={(e) => {
                            e.stopPropagation()
                            void jumpToLatestIdProfile(r.confirmationNumber)
                          }}
                          style={{ padding: 0, fontSize: 12, textDecoration: 'underline' }}
                        >
                          {r.guestName ?? '—'}
                        </button>
                      ) : (
                        <span>{r.guestName ?? '—'}</span>
                      )}
                    </td>
                    <td className="fdn-id-log__cell-when">
                      {formatKeyHistoryShortYmdHm(r.encodedAt) ??
                        new Date(r.encodedAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                    </td>
                    <td className="fdn-id-log__cell-conf">{r.confirmationNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      )}
    </section>
  )
}
