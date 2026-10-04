// Mineflayer visits chunk sections in Manhattan-distance shells. A Euclidean
// radius passed directly as maxDistance can omit loaded diagonal sections.
// Widen only the section scan; callers must filter the original sphere in
// useExtraInfo, before Mineflayer applies its result count cap.
export function sectionSearchDistance(radius) {
  if (!Number.isFinite(radius) || radius < 1 || radius > 64) throw new RangeError('Block search radius must be between 1 and 64');
  return Math.ceil(radius * Math.sqrt(3) + 24);
}
