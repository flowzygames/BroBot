import test from 'node:test'
import assert from 'node:assert/strict'
import { ActionRunner } from '../src/runner.js'
import { retainOperationResult } from '../src/action-error-result.js'

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
