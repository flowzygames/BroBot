// Construction must target the particular attachment face, not merely any
// visible face of its reference block. This conservative guard is for full cubes.
export function visiblePlacementFace(world, eye, reference, face, reach = 4.2) {
  if (!world?.raycast || !eye || !reference?.position || reference.boundingBox !== 'block') return false;
  if (!face || ![face.x, face.y, face.z].every(Number.isInteger) || Math.abs(face.x) + Math.abs(face.y) + Math.abs(face.z) !== 1) return false;
  if (!Number.isFinite(reach) || reach <= 0) return false;
  const shapes = reference.shapes;
  if (!Array.isArray(shapes) || shapes.length !== 1 || shapes[0].length !== 6 || !shapes[0].every((n, i) => n === (i < 3 ? 0 : 1))) return false;
  const center = reference.position.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5);
  const fromFace = eye.minus(center);
  if (fromFace.x * face.x + fromFace.y * face.y + fromFace.z * face.z <= 0.001) return false;
  const delta = center.minus(eye), distance = delta.norm();
  if (!Number.isFinite(distance) || distance < 0.001 || distance > reach) return false;
  const expectedFace = face.y === -1 ? 0 : face.y === 1 ? 1 : face.z === -1 ? 2 : face.z === 1 ? 3 : face.x === -1 ? 4 : 5;
  const hit = world.raycast(eye, delta.scaled(1 / distance), distance + 0.001);
  return !!hit?.position?.equals(reference.position) && hit.face === expectedFace;
}

// A collision snapshot is insufficient for natural leaf floors: removing logs
// can detach them. Return a concrete retained log connection, at most six leaf
// blocks long, or fail closed. Call again after every planned/actual mutation.
export function retainedLeafAnchor(blockAt, position, { maxNodes = 512 } = {}) {
  if (typeof blockAt !== 'function' || !position?.floored || !Number.isInteger(maxNodes) || maxNodes < 1) return null;
  const start = position.floored(), first = blockAt(start);
  const safe = b => b && !b.isWaterlogged && b.boundingBox === 'block';
  if (!safe(first) || !/_leaves$/.test(first.name)) return null;
  const queue = [{ position: start, path: [start] }], seen = new Set([start.toString()]);
  const sides = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let visited = 0;
  for (let head = 0; head < queue.length; head++) {
    if (++visited > maxNodes) return null;
    const node = queue[head];
    for (const [x,y,z] of sides) {
      const p = node.position.offset(x,y,z), b = blockAt(p);
      if (!safe(b)) continue;
      if (/_log$/.test(b.name)) return { leaves: node.path.map(q => q.toArray()), anchor: p.toArray(), distance: node.path.length };
      if (node.path.length >= 6 || !/_leaves$/.test(b.name) || seen.has(p.toString())) continue;
      seen.add(p.toString()); queue.push({ position: p, path: [...node.path, p] });
    }
  }
  return null;
}
