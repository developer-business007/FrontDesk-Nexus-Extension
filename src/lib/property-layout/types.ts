/** Weighted undirected graph: room number → neighbor → distance. */
export type RoomGraph = Map<string, Map<string, number>>

export type PropertyLayout = {
  id: string
  name: string
  floors: number[]
  /** Per-floor corridor graph (room numbers as strings). */
  graphsByFloor: Map<number, RoomGraph>
  /** Rooms nearest each elevator on a given floor (for fallback scoring). */
  elevatorHubs: (floor: number) => string[]
}

export type RoomClusterPick = {
  rooms: string[]
  maxDistance: number
  quality: 'adjacent' | 'nearby' | 'split'
}
