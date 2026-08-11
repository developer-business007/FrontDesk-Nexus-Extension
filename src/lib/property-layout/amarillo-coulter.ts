import { addCorridorChain, addUndirectedEdge } from './graph'
import type { PropertyLayout, RoomGraph } from './types'

/** Floor-1 base room numbers — repeated on 2xx / 3xx via {@link roomOnFloor}. */
const WING_A_ODD = [103, 105, 107, 109, 111, 115, 117, 119, 121, 123]
const WING_A_EVEN = [104, 106, 108, 110, 112, 114, 116, 118, 120, 122]
const WING_B_ODD = [139, 137, 135, 133, 131, 129, 127, 125]
const WING_B_EVEN = [138, 136, 134, 132, 130, 128, 126, 124]
const WING_C_ODD = [141, 143, 145, 147]
const WING_C_EVEN = [140, 142, 144, 146]

const FLOORS = [1, 2, 3]

function roomOnFloor(baseRoom: number, floor: number): string {
  return String(floor * 100 + (baseRoom % 100))
}

function mapFloorRooms(baseRooms: number[], floor: number): string[] {
  return baseRooms.map((r) => roomOnFloor(r, floor))
}

function buildFloorGraph(floor: number): RoomGraph {
  const graph: RoomGraph = new Map()

  addCorridorChain(graph, mapFloorRooms(WING_A_ODD, floor))
  addCorridorChain(graph, mapFloorRooms(WING_A_EVEN, floor))
  addCorridorChain(graph, mapFloorRooms(WING_B_ODD, floor))
  addCorridorChain(graph, mapFloorRooms(WING_B_EVEN, floor))
  addCorridorChain(graph, mapFloorRooms(WING_C_ODD, floor))
  addCorridorChain(graph, mapFloorRooms(WING_C_EVEN, floor))

  const r = (base: number) => roomOnFloor(base, floor)

  // Elevator 1 — junction between Building A and Building B (lobby end of A).
  addUndirectedEdge(graph, r(122), r(124), 3)
  addUndirectedEdge(graph, r(123), r(125), 3)
  addUndirectedEdge(graph, r(122), r(125), 4)
  addUndirectedEdge(graph, r(123), r(124), 4)

  // Building B ↔ Building C — bridgeways on 2nd/3rd; longer interior path on 1st.
  const bToCWeight = floor >= 2 ? 3 : 8
  addUndirectedEdge(graph, r(138), r(140), bToCWeight)
  addUndirectedEdge(graph, r(139), r(141), bToCWeight)
  addUndirectedEdge(graph, r(138), r(141), bToCWeight + 1)
  addUndirectedEdge(graph, r(139), r(140), bToCWeight + 1)

  return graph
}

function elevatorHubsForFloor(floor: number): string[] {
  return [
    roomOnFloor(122, floor),
    roomOnFloor(123, floor),
    roomOnFloor(124, floor),
    roomOnFloor(125, floor),
    roomOnFloor(140, floor),
    roomOnFloor(141, floor),
  ]
}

const graphsByFloor = new Map<number, RoomGraph>()
for (const floor of FLOORS) {
  graphsByFloor.set(floor, buildFloorGraph(floor))
}

/** 2108 S. Coulter — Buildings A, B, C with bridgeways on floors 2–3. */
export const AMARILLO_COULTER_LAYOUT: PropertyLayout = {
  id: 'amarillo-coulter',
  name: 'Amarillo Coulter (A / B / C)',
  floors: FLOORS,
  graphsByFloor,
  elevatorHubs: elevatorHubsForFloor,
}

export function isAmarilloCoulterRoom(roomNumber: string): boolean {
  const n = parseInt(roomNumber.trim(), 10)
  if (!Number.isFinite(n) || n < 100) return false
  const floor = Math.floor(n / 100)
  if (!FLOORS.includes(floor)) return false
  const suffix = n % 100
  return suffix >= 3 && suffix <= 47
}
