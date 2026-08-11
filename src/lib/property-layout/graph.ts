import type { PropertyLayout, RoomClusterPick, RoomGraph } from './types'

export function addUndirectedEdge(graph: RoomGraph, a: string, b: string, weight: number): void {
  if (a === b) return
  if (!graph.has(a)) graph.set(a, new Map())
  if (!graph.has(b)) graph.set(b, new Map())
  const existingA = graph.get(a)!.get(b)
  if (existingA !== undefined && existingA <= weight) return
  graph.get(a)!.set(b, weight)
  graph.get(b)!.set(a, weight)
}

export function addCorridorChain(graph: RoomGraph, rooms: string[]): void {
  for (let i = 0; i < rooms.length - 1; i++) {
    addUndirectedEdge(graph, rooms[i]!, rooms[i + 1]!, 1)
  }
}

/** Shortest-path distance; returns Infinity when unreachable. */
export function graphDistance(graph: RoomGraph, from: string, to: string): number {
  if (from === to) return 0
  const visited = new Set<string>()
  const queue: { node: string; dist: number }[] = [{ node: from, dist: 0 }]
  while (queue.length > 0) {
    const { node, dist } = queue.shift()!
    if (node === to) return dist
    if (visited.has(node)) continue
    visited.add(node)
    const neighbors = graph.get(node)
    if (!neighbors) continue
    for (const [next, weight] of neighbors) {
      if (!visited.has(next)) queue.push({ node: next, dist: dist + weight })
    }
  }
  return Number.POSITIVE_INFINITY
}

function clusterDiameter(graph: RoomGraph, rooms: string[]): number {
  let max = 0
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const d = graphDistance(graph, rooms[i]!, rooms[j]!)
      if (!Number.isFinite(d)) return Number.POSITIVE_INFINITY
      if (d > max) max = d
    }
  }
  return max
}

function clusterQuality(maxDistance: number): RoomClusterPick['quality'] {
  if (maxDistance <= 1) return 'adjacent'
  if (maxDistance <= 6) return 'nearby'
  return 'split'
}

function roomParity(room: string): 'even' | 'odd' {
  const n = parseInt(room, 10)
  return Number.isFinite(n) && n % 2 === 0 ? 'even' : 'odd'
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count <= 0) return [[]]
  if (items.length < count) return []
  if (count === 1) return items.map((item) => [item])
  const out: T[][] = []
  for (let i = 0; i <= items.length - count; i++) {
    const head = items[i]!
    for (const tail of combinations(items.slice(i + 1), count - 1)) {
      out.push([head, ...tail])
    }
  }
  return out
}

function minElevatorDistance(graph: RoomGraph, rooms: string[], elevatorHubs: string[]): number {
  if (elevatorHubs.length === 0) return 0
  let best = Number.POSITIVE_INFINITY
  for (const room of rooms) {
    for (const hub of elevatorHubs) {
      const d = graphDistance(graph, room, hub)
      if (d < best) best = d
    }
  }
  return best
}

/**
 * Pick `count` rooms minimizing corridor-graph distance.
 * Same parity (same hallway side) is preferred for multi-room picks.
 */
export function pickClosestRoomCluster(
  graph: RoomGraph,
  availableRooms: string[],
  count: number,
  elevatorHubs: string[] = [],
): RoomClusterPick | null {
  const pool = [...new Set(availableRooms)].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  if (count < 1 || pool.length < count) return null
  if (count === 1) {
    let bestRoom = pool[0]!
    if (elevatorHubs.length > 0) {
      let bestElev = Number.POSITIVE_INFINITY
      for (const room of pool) {
        const elev = minElevatorDistance(graph, [room], elevatorHubs)
        if (elev < bestElev) {
          bestElev = elev
          bestRoom = room
        }
      }
    }
    return { rooms: [bestRoom], maxDistance: 0, quality: 'adjacent' }
  }

  type Scored = RoomClusterPick & { elevatorDist: number; sameParity: boolean }
  const candidates: Scored[] = []

  const parityGroups: { rooms: string[] }[] = [
    { rooms: pool.filter((r) => roomParity(r) === 'even') },
    { rooms: pool.filter((r) => roomParity(r) === 'odd') },
  ]

  const tryGroup = (rooms: string[], sameParity: boolean) => {
    if (rooms.length < count) return
    for (const combo of combinations(rooms, count)) {
      const maxDistance = clusterDiameter(graph, combo)
      if (!Number.isFinite(maxDistance)) continue
      candidates.push({
        rooms: combo,
        maxDistance,
        quality: clusterQuality(maxDistance),
        elevatorDist: minElevatorDistance(graph, combo, elevatorHubs),
        sameParity,
      })
    }
  }

  for (const group of parityGroups) tryGroup(group.rooms, true)
  if (candidates.length === 0) tryGroup(pool, false)
  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    if (a.sameParity !== b.sameParity) return a.sameParity ? -1 : 1
    if (a.maxDistance !== b.maxDistance) return a.maxDistance - b.maxDistance
    if (a.elevatorDist !== b.elevatorDist) return a.elevatorDist - b.elevatorDist
    const aSpread = parseInt(a.rooms[a.rooms.length - 1]!, 10) - parseInt(a.rooms[0]!, 10)
    const bSpread = parseInt(b.rooms[b.rooms.length - 1]!, 10) - parseInt(b.rooms[0]!, 10)
    return aSpread - bSpread
  })

  const best = candidates[0]!
  return { rooms: best.rooms, maxDistance: best.maxDistance, quality: best.quality }
}

export function pickClosestRoomClusterForLayout(
  layout: PropertyLayout,
  floor: number,
  availableRooms: string[],
  count: number,
): RoomClusterPick | null {
  const graph = layout.graphsByFloor.get(floor)
  if (!graph) return null
  const onFloor = availableRooms.filter((r) => {
    const n = parseInt(r, 10)
    return Number.isFinite(n) && Math.floor(n / 100) === floor
  })
  return pickClosestRoomCluster(graph, onFloor, count, layout.elevatorHubs(floor))
}

export function isRoomOnLayout(layout: PropertyLayout, roomNumber: string): boolean {
  const n = parseInt(roomNumber, 10)
  if (!Number.isFinite(n)) return false
  const floor = Math.floor(n / 100)
  const graph = layout.graphsByFloor.get(floor)
  return graph?.has(roomNumber.trim()) ?? false
}
