import { AMARILLO_COULTER_LAYOUT, isAmarilloCoulterRoom } from './amarillo-coulter'
import type { PropertyLayout } from './types'

export type { PropertyLayout, RoomClusterPick, RoomGraph } from './types'
export {
  addCorridorChain,
  addUndirectedEdge,
  graphDistance,
  isRoomOnLayout,
  pickClosestRoomCluster,
  pickClosestRoomClusterForLayout,
} from './graph'
export { AMARILLO_COULTER_LAYOUT, isAmarilloCoulterRoom } from './amarillo-coulter'

/** Default property layout for this deployment. */
export function getDefaultPropertyLayout(): PropertyLayout {
  return AMARILLO_COULTER_LAYOUT
}

export function resolvePropertyLayoutForRoom(roomNumber: string): PropertyLayout | null {
  if (isAmarilloCoulterRoom(roomNumber)) return AMARILLO_COULTER_LAYOUT
  return null
}
