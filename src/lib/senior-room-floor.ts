/** Infer hotel floor from room number (`101` → 1, `1203` → 12). */
export function roomFloorFromNumber(room: string): number | null {
  const trimmed = room.trim()
  if (!trimmed) return null
  const n = parseInt(trimmed, 10)
  if (!Number.isFinite(n) || n < 1) return null
  if (n < 100) return n
  return Math.floor(n / 100)
}
