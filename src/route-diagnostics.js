import { retainOperationResult } from './action-error-result.js';

const phases = new Set(['forward', 'reverse']);
const statuses = new Set(['success', 'partial', 'noPath', 'timeout']);
const witnessReasons = {
  success: new Set(['initial_endpoint', 'retained_corridor', 'final_edge']),
  declined: new Set(['policy', 'input', 'cap', 'cancelled', 'local_deadline', 'planning_deadline', 'deadline', 'event', 'context', 'corridor_unverified', 'final_edge_unverified', 'exception'])
};
const own = (value, key) => {
  if (value == null || !['object', 'function'].includes(typeof value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};

// Only allowlisted, own data properties are diagnostic evidence. Never invoke
// error/result getters or copy arbitrary planner objects into the journal.
export function reverseWitness(value) {
  try {
    const status = own(value, 'status'), reason = own(value, 'reason');
    if (!['success', 'declined'].includes(status) || !witnessReasons[status].has(reason)) return null;
    const result = { status, reason };
    for (const key of ['forward_nodes', 'validated_edges']) {
      const count = own(value, key);
      if (Number.isSafeInteger(count) && count >= 0 && count <= 64) result[key] = count;
    }
    if (result.forward_nodes === 64 && own(value, 'forward_nodes_capped') === true) result.forward_nodes_capped = true;
    return result;
  } catch { return null; }
}
export function routeFailure(error) {
  try { return normalized(own(own(error, 'result'), 'route_failure')); } catch { return null; }
}
function normalized(value) {
  const phase = own(value, 'phase');
  if (!phases.has(phase)) return null;
  const plannerStatus = own(value, 'planner_status');
  const witness = phase === 'reverse' ? reverseWitness(own(value, 'reverse_witness')) : null;
  return { phase, ...(statuses.has(plannerStatus) ? { planner_status: plannerStatus } : {}), ...(witness ? { reverse_witness: witness } : {}) };
}
export function annotateRouteFailure(error, phase, plannerStatus, witness = null) {
  try {
    const diagnostic = normalized({ phase, planner_status: plannerStatus, reverse_witness: witness });
    if (!diagnostic) return error;
    const previous = own(error, 'result'), result = {};
    if (previous && typeof previous === 'object') {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(previous))) {
        if (descriptor.enumerable && Object.hasOwn(descriptor, 'value')) {
          Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
        }
      }
    }
    result.route_failure = diagnostic;
    return retainOperationResult(error, { result });
  } catch { return error; }
}

export function routeFailureLog(error) {
  try {
    const result = own(error, 'result'), output = {}, root = normalized(own(result, 'route_failure'));
    if (root) output.route_failure = root;
    for (const [key, cap] of [['route_attempts', 4], ['failures', 8], ['pickup_failures', 64], ['unreachable', 64]]) {
      const values = own(result, key);
      if (!Array.isArray(values)) continue;
      const records = [];
      for (let i = 0; i < Math.min(values.length, cap); i++) {
        const entry = own(values, String(i)), diagnostic = normalized(own(entry, 'route_failure'));
        if (!diagnostic) continue;
        const record = { route_failure: diagnostic }, direction = own(entry, 'direction'), id = own(entry, 'id'), position = own(entry, 'position');
        if (['north', 'south', 'east', 'west'].includes(direction)) record.direction = direction;
        if (Number.isSafeInteger(id) && id >= 0) record.id = id;
        const coordinates = ['x', 'y', 'z'].map(k => own(position, k));
        if (coordinates.every(Number.isSafeInteger)) record.position = Object.fromEntries(['x', 'y', 'z'].map((k, j) => [k, coordinates[j]]));
        records.push(record);
      }
      if (records.length) {
        output[key] = records;
        if (values.length > cap) output[`${key}_omitted_entries`] = values.length - cap;
      }
    }
    return Object.keys(output).length ? output : null;
  } catch { return null; }
}
