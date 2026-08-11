export type PmsHkRequestChoice = 0 | 1 | 2

type Props = {
  open: boolean
  selectedCount: number
  requestStatus: PmsHkRequestChoice
  busy: boolean
  error: string | null
  onRequestStatusChange: (status: PmsHkRequestChoice) => void
  onClose: () => void
  onSend: () => void
}

export function PmsHousekeepingDialog({
  open,
  selectedCount,
  requestStatus,
  busy,
  error,
  onRequestStatusChange,
  onClose,
  onSend,
}: Props) {
  if (!open) return null

  return (
    <div
      className="fdn-dualpms__modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fdn-dualpms__modal fdn-dualpms__hk-modal">
        <h3 className="fdn-h2">
          {selectedCount} room{selectedCount === 1 ? '' : 's'} selected
        </h3>

        <table className="fdn-dualpms__hk-table">
          <tbody>
            <tr>
              <td>
                <input
                  id="ext-pms-hk-clean"
                  type="checkbox"
                  checked={requestStatus === 2}
                  onChange={(e) => onRequestStatusChange(e.target.checked ? 2 : 0)}
                />
              </td>
              <td>
                <label htmlFor="ext-pms-hk-clean">Mark them clean</label>
              </td>
            </tr>
            <tr>
              <td>
                <input
                  id="ext-pms-hk-dirty"
                  type="checkbox"
                  checked={requestStatus === 1}
                  onChange={(e) => onRequestStatusChange(e.target.checked ? 1 : 0)}
                />
              </td>
              <td>
                <label htmlFor="ext-pms-hk-dirty">Mark them dirty</label>
              </td>
            </tr>
          </tbody>
        </table>

        {error ? (
          <p className="fdn-dualpms__hk-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="fdn-dualpms__hk-actions">
          <button type="button" className="fdn-btn fdn-btn--secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fdn-btn fdn-btn--primary"
            disabled={busy || requestStatus === 0}
            onClick={onSend}
          >
            {busy ? 'Sending…' : 'Send Request'}
          </button>
        </div>

        <p className="fdn-dualpms__hk-note">
          <strong>Note:</strong> It takes up to 60 seconds for the housekeeping status change request to
          take effect.
        </p>
      </div>
    </div>
  )
}
