type IdScanAlertsProps = {
  dnrCheckBusy: boolean
  dnrActive: boolean
  underage: boolean
  guestAgeYears: number | null
  minimumCheckInAge: number
  hasDob: boolean
  expired: boolean
  underageApproved?: boolean
  onRequestUnderageApproval?: () => void
}

/** Warnings shown after an ID scan (expired, underage, blacklist / DNR). */
export function IdScanAlerts({
  dnrCheckBusy,
  dnrActive,
  underage,
  guestAgeYears,
  minimumCheckInAge,
  hasDob,
  expired,
  underageApproved,
  onRequestUnderageApproval,
}: IdScanAlertsProps) {
  const showUnderage = underage && minimumCheckInAge > 0
  const showPending = dnrCheckBusy && !dnrActive && !showUnderage

  if (!showPending && !showUnderage && !dnrActive && !expired) return null

  return (
    <div className="fdn-id-alerts" role="status" aria-live="polite">
      {expired ? (
        <p className="fdn-id-alert fdn-id-alert--expired">
          <strong>ID expired</strong> — this document is past its expiration date. Request a current
          valid ID or verify with a manager before check-in.
        </p>
      ) : null}
      {showPending ? (
        <p className="fdn-id-alert fdn-id-alert--pending">Checking blacklist and age rules…</p>
      ) : null}
      {showUnderage ? (
        <p className="fdn-id-alert fdn-id-alert--underage">
          <strong>Underage warning</strong> — guest is{' '}
          {guestAgeYears !== null ? (
            <>
              <strong>{guestAgeYears}</strong> years old
            </>
          ) : (
            'below the hotel minimum'
          )}
          ; minimum check-in age is <strong>{minimumCheckInAge}</strong>.{' '}
          {underageApproved ? (
            <span className="fdn-id-alert__approved">Manager authorized.</span>
          ) : onRequestUnderageApproval ? (
            <>
              Manager must authorize before To PMS.{' '}
              <button
                type="button"
                className="fdn-id-alert__approve-btn"
                onClick={onRequestUnderageApproval}
              >
                Authorize
              </button>
            </>
          ) : (
            'Verify ID and get manager approval before renting a room.'
          )}
        </p>
      ) : null}
      {hasDob && minimumCheckInAge > 0 && guestAgeYears === null && !showUnderage ? (
        <p className="fdn-id-alert fdn-id-alert--pending">
          Could not verify age from date of birth — confirm DOB manually.
        </p>
      ) : null}
      {dnrActive ? (
        <p className="fdn-id-alert fdn-id-alert--dnr">
          <strong>Blacklisted — Do Not Rent</strong> — this guest is on the property DNR list. Do not
          check them in unless a manager approves. Use manager verification to save an ID record with
          override.
        </p>
      ) : null}
    </div>
  )
}
