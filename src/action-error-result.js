// Keep the initiating cancellation/session error while retaining the drained
// operation's own partial result. Missing progress is not evidence of zero edits.
export function retainOperationResult(reason, operationError) {
  if (reason === operationError || !operationError) return reason
  const descriptor = Object.getOwnPropertyDescriptor(operationError, 'result')
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return reason
  const result = descriptor.value
  try { reason.result = result; return reason }
  catch {
    const replacement = new Error(reason?.message ?? String(reason), { cause: reason })
    replacement.name = reason?.name ?? 'Error'
    if (reason?.code !== undefined) replacement.code = reason.code
    replacement.result = result
    return replacement
  }
}
