import { STARTER_MOVEMENT_RADIUS, STARTER_SCOUT_LIMIT } from './starter-limits.js';
// A coverage heuristic, not a claim that chunks or routes are loaded. Only
// positions where an observation actually finished enter the coverage history.
const directions = ['north', 'east', 'south', 'west'];
const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const valid = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function recordScoutObservation(history, position) {
  const points = (Array.isArray(history) ? history : []).filter(valid).slice(-64);
  if (valid(position) && !points.some(p => distance(p, position) <= 2)) points.push({ ...position });
  return points.slice(-64);
}

export function rankScouts({ position, home, index, observations = [], attempts = [], radius = STARTER_MOVEMENT_RADIUS, maxScouts = STARTER_SCOUT_LIMIT }) {
  if (!valid(position) || !valid(home) || !Number.isSafeInteger(index) || index < 0 || index >= maxScouts || !Number.isFinite(radius) || radius <= 0 || radius > STARTER_MOVEMENT_RADIUS || !Number.isSafeInteger(maxScouts) || maxScouts < 1 || maxScouts > STARTER_SCOUT_LIMIT) return [];
  const plannedTravel = Math.min(64, 12 * (1 + Math.floor(index / 2)));
  const points = recordScoutObservation(observations, position);
  const tried = (Array.isArray(attempts) ? attempts : []).filter(a => a && directions.includes(a.direction) && valid(a.origin)).slice(-STARTER_SCOUT_LIMIT * 4);
  // An exhausted local sweep is evidence that this leg was not certified,
  // not evidence that every shorter route is blocked. Try a smaller leg on
  // the next scout, within the same attempt/time and return-path budgets.
  // Old attempts without explicit outcome evidence retain their old behavior.
  const exhausted = tried.filter(a => a.exhausted === true && a.status === 'unverified'
    && Number.isInteger(a.distance) && a.distance >= 4 && a.distance <= 64
    && distance(a.origin, position) <= 2);
  const travel = exhausted.length
    ? Math.min(plannedTravel, Math.max(4, Math.floor(Math.min(...exhausted.map(a => a.distance)) / 2)))
    : plannedTravel;
  const candidates = directions.map((direction, order) => {
    const [dx, dz] = offsets[direction];
    const target = { x: position.x + dx * travel, y: position.y, z: position.z + dz * travel };
    const floored = Object.fromEntries(Object.entries(target).map(([k, v]) => [k, Math.floor(v)]));
    if (distance(target, home) > radius || distance(floored, home) > radius) return null;
    // Fixed 8-block lattice estimates newly searched horizontal area inside the
    // existing job boundary. It reads no hidden terrain, resource or seed data.
    // Elevation, loaded chunks and walkability remain execution-time checks.
    let coverage = 0;
    const edge = Math.floor(radius / 8) * 8;
    for (let x = -edge; x <= edge; x += 8) for (let z = -edge; z <= edge; z += 8) {
      if (x * x + z * z > radius * radius) continue;
      const px = home.x + x, pz = home.z + z;
      if (Math.hypot(px - target.x, pz - target.z) > 48) continue;
      if (points.every(p => Math.hypot(px - p.x, pz - p.z) > 48)) coverage++;
    }
    // A failed or partial move is not a visited destination. Try another
    // direction first when still near the same origin, even at a new distance.
    const repeated = tried.filter(a => a.direction === direction && valid(a.origin) && distance(a.origin, position) <= 4).length;
    return { direction, distance: travel, returnable: true, coverage, repeated, order: (order - index % 4 + 4) % 4 };
  }).filter(Boolean);
  candidates.sort((a, b) => a.repeated - b.repeated || b.coverage - a.coverage || a.order - b.order);
  return candidates.map(c => ({ direction: c.direction, distance: c.distance, returnable: true }));
}
export function selectScout(args) { return rankScouts(args)[0] ?? null; }
