/**
 * Returns true if expiryDate is a valid date strictly in the past (day before today or earlier).
 * Returns false if the string is blank or cannot be parsed.
 */
export function isIdExpired(expiryDate: string | null | undefined): boolean {
  if (!expiryDate?.trim()) return false
  const trimmed = expiryDate.trim()
  let d: Date | null = null

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  }

  if (!d) {
    const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (us) {
      d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]))
    }
  }

  if (!d) {
    const t = Date.parse(trimmed)
    if (!Number.isNaN(t)) d = new Date(t)
  }

  if (!d || Number.isNaN(d.getTime())) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

/** Whole years since DOB (hotel check-in age rules). Returns null if DOB is missing or invalid. */
export function ageYearsFromDobString(dob: string | null | undefined): number | null {
  if (!dob?.trim()) return null
  const trimmed = dob.trim()

  const t = Date.parse(trimmed)
  if (!Number.isNaN(t)) {
    const d = new Date(t)
    if (Number.isNaN(d.getTime())) return null
    return yearsBetweenDates(d, new Date())
  }

  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) {
    const month = Number(us[1])
    const day = Number(us[2])
    const year = Number(us[3])
    const d = new Date(year, month - 1, day)
    if (Number.isNaN(d.getTime())) return null
    return yearsBetweenDates(d, new Date())
  }

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    if (Number.isNaN(d.getTime())) return null
    return yearsBetweenDates(d, new Date())
  }

  return null
}

function yearsBetweenDates(birth: Date, today: Date): number | null {
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age >= 0 ? age : null
}

/** `minimumAge` 0 disables the check. */
export function isGuestUnderMinimumAge(
  dob: string | null | undefined,
  minimumAge: number,
): boolean {
  if (minimumAge <= 0) return false
  const age = ageYearsFromDobString(dob)
  if (age === null) return false
  return age < minimumAge
}
