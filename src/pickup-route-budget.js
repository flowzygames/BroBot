// Admission policy, not a measured travel-time guarantee. Execution may replan,
// and lag/collisions can still delay an admitted path. Existing timeout and
// grounded-stop safeguards remain mandatory.
export const PICKUP_ROUTE_BUDGET = 'PICKUP_ROUTE_BUDGET'
export function pickupRouteBudget (start, path, availableMs) {
  const valid = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]))
  if (!valid(start) || !Array.isArray(path) || !Number.isFinite(availableMs) || availableMs < 0 || path.some(p => !valid(p))) {
    return { admitted:false, reason:'Missing or invalid certified route geometry', available_ms:availableMs, estimated_ms:null }
  }
  let previous=start, horizontal=0, ascent=0, descent=0
  for (const node of path) {
    // Certified path nodes are standing cells; travel is to their centers.
    const point={x:node.x+.5,y:node.y,z:node.z+.5}
    horizontal+=Math.hypot(point.x-previous.x,point.z-previous.z)
    ascent+=Math.max(0,point.y-previous.y)
    descent+=Math.max(0,previous.y-point.y)
    previous=point
  }
  const estimated=Math.ceil(750+350*horizontal+500*ascent+250*descent)
  return {admitted:estimated<=availableMs,reason:estimated<=availableMs?null:'Certified pickup route exceeds the remaining pursuit allowance',estimated_ms:estimated,available_ms:availableMs,nodes:path.length,horizontal_distance:horizontal,ascent,descent}
}
