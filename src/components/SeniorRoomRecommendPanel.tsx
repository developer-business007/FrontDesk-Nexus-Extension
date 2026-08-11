import type { SeniorRoomRecommendResult, SeniorRoomTypeRequest } from '../shared/protocol'
import { ROOM_TYPE_LABELS, ROOM_TYPES } from '../lib/room-types'

type SeniorRoomRecommendPanelProps = {
  guestAgeYears: number
  busy: boolean
  result: SeniorRoomRecommendResult | null
  error: string | null
  requests: SeniorRoomTypeRequest[]
  onRequestsChange: (next: SeniorRoomTypeRequest[]) => void
}

function preferenceLabel(result: SeniorRoomRecommendResult): string {
  if (result.usedCustomList) return 'preferred rooms'
  if (result.floor != null) return `floor ${result.floor}`
  if (result.preferredFloors.length === 1) return `floor ${result.preferredFloors[0]}`
  return `floors ${result.preferredFloors.join(', ')}`
}

function clusterLabel(result: SeniorRoomRecommendResult): string {
  if (result.clusterQuality === 'adjacent') return 'adjoining'
  if (result.clusterQuality === 'nearby') return 'nearby'
  if (result.clusterQuality === 'split') return 'farther apart'
  return result.sameFloorCluster ? 'closest together' : 'split by availability'
}

/** Senior guest room picker — DualPMS vacant + HK-clean rooms by type, clustered on preferred floor. */
export function SeniorRoomRecommendPanel({
  guestAgeYears,
  busy,
  result,
  error,
  requests,
  onRequestsChange,
}: SeniorRoomRecommendPanelProps) {
  const updateLine = (index: number, patch: Partial<SeniorRoomTypeRequest>) => {
    const next = requests.map((row, i) => (i === index ? { ...row, ...patch } : row))
    onRequestsChange(next)
  }

  const addLine = () => {
    if (requests.length >= 3) return
    onRequestsChange([...requests, { roomType: 'NK1', count: 1 }])
  }

  const removeLine = (index: number) => {
    if (requests.length <= 1) return
    onRequestsChange(requests.filter((_, i) => i !== index))
  }

  return (
    <div className="fdn-senior-rec" role="region" aria-label="Senior room recommendations">
      <p className="fdn-senior-rec__title">
        <strong>Senior guest ({guestAgeYears})</strong> — vacant clean rooms from DualPMS
      </p>

      <div className="fdn-senior-rec__form">
        {requests.map((row, index) => (
          <div key={index} className="fdn-senior-rec__row">
            <label className="fdn-senior-rec__field">
              <span className="fdn-senior-rec__label">Room type</span>
              <select
                className="fdn-input fdn-senior-rec__select"
                value={row.roomType}
                onChange={(e) => updateLine(index, { roomType: e.target.value })}
              >
                {ROOM_TYPES.map((code) => (
                  <option key={code} value={code}>
                    {ROOM_TYPE_LABELS[code]}
                  </option>
                ))}
              </select>
            </label>
            <label className="fdn-senior-rec__field fdn-senior-rec__field--count">
              <span className="fdn-senior-rec__label">Qty</span>
              <select
                className="fdn-input fdn-senior-rec__select"
                value={row.count}
                onChange={(e) => updateLine(index, { count: Number(e.target.value) })}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {requests.length > 1 ? (
              <button
                type="button"
                className="fdn-btn fdn-btn--secondary fdn-senior-rec__remove"
                onClick={() => removeLine(index)}
                title="Remove room type line"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        {requests.length < 3 ? (
          <button type="button" className="fdn-btn fdn-btn--secondary fdn-senior-rec__add" onClick={addLine}>
            + Add room type
          </button>
        ) : null}
      </div>

      {busy ? (
        <p className="fdn-id-alert fdn-id-alert--senior fdn-id-alert--pending" role="status">
          Checking DualPMS vacant rooms…
        </p>
      ) : error ? (
        <p className="fdn-id-alert fdn-id-alert--senior" role="status">
          Could not load recommendations ({error}).
        </p>
      ) : result ? (
        <div className="fdn-senior-rec__result" role="status">
          {result.groups.some((g) => g.rooms.length > 0) ? (
            <>
              <p className="fdn-id-alert fdn-id-alert--senior">
                Recommended on <strong>{preferenceLabel(result)}</strong> ({clusterLabel(result)}):
              </p>
              <ul className="fdn-senior-rec__groups">
                {result.groups.map((group) => (
                  <li key={`${group.roomType}-${group.count}`}>
                    <strong>
                      {group.roomType}
                      {group.rooms.length < group.count
                        ? ` (need ${group.count}, found ${group.rooms.length})`
                        : ''}
                      : {group.rooms.map((r) => r.roomNumber).join(', ') || '—'}
                    </strong>
                  </li>
                ))}
              </ul>
              {result.needsGuestConfirmation ? (
                <p className="fdn-id-alert fdn-id-alert--senior fdn-id-alert--pending">
                  Confirm with guest before assigning — see notes below.
                </p>
              ) : null}
              {result.notes.length > 0 ? (
                <ul className="fdn-senior-rec__notes">
                  {result.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : result.fallback.length > 0 ? (
            <p className="fdn-id-alert fdn-id-alert--senior">
              No matching vacant clean rooms for selected types on {preferenceLabel(result)}. Other
              vacant rooms: <strong>{result.fallback.map((r) => r.roomNumber).join(', ')}</strong>
            </p>
          ) : (
            <p className="fdn-id-alert fdn-id-alert--senior">
              No vacant clean rooms for selected types right now (occupied, dirty, OOO, or blocked in
              DualPMS).
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
