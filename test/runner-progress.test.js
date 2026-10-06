import test from 'node:test'
import assert from 'node:assert/strict'
import { ActionRunner } from '../src/runner.js'
import { retainOperationResult, retainOperationProgress } from '../src/action-error-result.js'

for (const frozen of [false, true]) test(`runner preserves confirmed partial work through cancellation, frozen reason=${frozen}`, async () => {
  const runner = new ActionRunner(); let release, signal
  const result = { completed: false, confirmed_soil_edits: 2, verified_descents: 1 }
  const pending = runner.run('soil', async current => {
    signal = current
    await new Promise(resolve => { release = resolve })
    throw Object.assign(Error('operation drained'), { result })
  })
  runner.stop('owner requested stop')
  if (frozen) Object.freeze(signal.reason)
  release()
  await assert.rejects(pending, error => {
    assert.equal(error.message, 'owner requested stop')
    assert.equal(error.result, result)
    return true
  })
  assert.equal(runner.active, null)
})

test('operation result survives a session-error replacement without changing the session reason', () => {
  const result = { completed: false, confirmed_soil_edits: 1 }
  const session = Error('play session changed')
  assert.equal(retainOperationResult(session, Object.assign(Error('old operation'), { result })), session)
  assert.equal(session.result, result)
  assert.equal(session.message, 'play session changed')
})

test('ordinary errors and missing receipts do not fabricate progress', () => {
  const error = Error('ordinary failure')
  assert.equal(retainOperationResult(error, error), error)
  const cancelled = Error('cancelled')
  assert.equal(retainOperationResult(cancelled, error), cancelled)
  assert.equal(Object.hasOwn(cancelled, 'result'), false)
})

test('cancellation immediately after an operation resolves retains its completed physical result', async () => {
  const runner = new ActionRunner(), result = { completed: true, confirmed_soil_edits: 5 }
  await assert.rejects(runner.run('soil', async () => {
    runner.stop('stop at completion')
    return result
  }), error => {
    assert.equal(error.message, 'stop at completion')
    assert.equal(error.result, result)
    return true
  })
  assert.equal(runner.active, null)
})

for (const mode of ['frozen', 'readonly', 'getter', 'setter']) test(`executor progress survives ${mode} error result`, () => {
  const reason = Object.assign(Error('owner stopped'), { code: 'STOPPED' })
  let setterCalls = 0
  if (mode === 'frozen') Object.freeze(reason)
  if (mode === 'readonly') Object.defineProperty(reason, 'result', { value: { diagnostic: 'preserved', confirmed_soil_edits: 0 } })
  if (mode === 'getter') Object.defineProperty(reason, 'result', { get() { throw Error('must not invoke getter') } })
  if (mode === 'setter') Object.defineProperty(reason, 'result', { get() { throw Error('must not invoke getter') }, set() { setterCalls++ } })
  const error = retainOperationProgress(reason, { confirmed_soil_edits: 1, completed: false })
  assert.equal(error.message, 'owner stopped')
  assert.equal(error.code, 'STOPPED')
  assert.equal(error.cause, reason)
  assert.equal(setterCalls, 0)
  assert.equal(error.result.confirmed_soil_edits, 1)
  assert.equal(error.result.completed, false)
  if (mode === 'readonly') assert.equal(error.result.diagnostic, 'preserved')
})
