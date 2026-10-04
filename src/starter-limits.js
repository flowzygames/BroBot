// Shared starter-job limits. Travel remains incremental and returnable; the
// larger search region is not permission to tunnel, swim, or teleport.
export const STARTER_MOVEMENT_RADIUS = 256;
export const STARTER_STOP_RADIUS = STARTER_MOVEMENT_RADIUS + 6;
export const STARTER_SCOUT_LIMIT = 24;
export const STARTER_LEG_RADIUS = 96;

// The starter guard and in-flight interruption share one health boundary.
export const STARTER_MIN_HEALTH = 8;
