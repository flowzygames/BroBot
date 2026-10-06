// Keep the initiating cancellation/session error while retaining the drained
// operation's own partial result. Missing progress is not evidence of zero edits.
export function retainOperationResult(reason, operationError) {
  if (reason === operationError || !operationError) return reason
  const descriptor = Object.getOwnPropertyDescriptor(operationError, 'result')
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return reason
  const result = descriptor.value
  try {
    const existing = Object.getOwnPropertyDescriptor(reason, 'result')
    if (existing && !Object.hasOwn(existing, 'value')) throw Error('Result accessor cannot retain operation progress')
    reason.result = result
    const retained = Object.getOwnPropertyDescriptor(reason, 'result')
    if (!retained || !Object.hasOwn(retained, 'value') || retained.value !== result) throw Error('Operation progress was not retained')
    return reason
  }
  catch {
    const replacement = new Error(reason?.message ?? String(reason), { cause: reason })
    replacement.name = reason?.name ?? 'Error'
    if (reason?.code !== undefined) replacement.code = reason.code
    replacement.result = result
    return replacement
  }
}

// Add authoritative executor progress without invoking an error's result getter.
// Frozen cancellation reasons must not erase physical effects already observed.
export function retainOperationProgress(reason, progress) {
  const descriptor = Object.getOwnPropertyDescriptor(reason, 'result')
  const previous = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  return retainOperationResult(reason, { result: { ...previous, ...progress } })
}
