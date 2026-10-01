import test from 'node:test'
import assert from 'node:assert/strict'
import { configureCollisionMargin } from '../src/collision-margin.js'
import { createActions } from '../src/actions.js'

const botWithDefaults = () => ({ version: '1.21.8', physics: { playerHalfWidth: 0.3, playerHeight: 1.8, stepHeight: 0.6 } })

test('collision prediction leaves a conservative margin without changing step height', () => {
  const bot = botWithDefaults()
  assert.equal(configureCollisionMargin(bot), true)
  assert.ok(bot.physics.playerHalfWidth > Math.fround(0.6) / 2)
  assert.ok(bot.physics.playerHalfWidth < 0.300001)
  assert.ok(bot.physics.playerHeight > 1.8 && bot.physics.playerHeight < 1.800001)
  assert.equal(bot.physics.stepHeight, 0.6)
  assert.equal(configureCollisionMargin(bot), false)
})

test('collision margin preserves custom dimensions and untested versions', () => {
  for (const override of [{ playerHalfWidth: 0.4 }, { playerHeight: 1.5 }]) {
    const bot = botWithDefaults(); Object.assign(bot.physics, override)
    const before = { ...bot.physics }
    assert.equal(configureCollisionMargin(bot), false)
    assert.deepEqual(bot.physics, before)
  }
  for (const version of [undefined, '1.20.4', '1.21.11']) {
    const bot = botWithDefaults(); bot.version = version
    assert.equal(configureCollisionMargin(bot), false)
    assert.equal(bot.physics.playerHalfWidth, 0.3)
  }
  assert.equal(configureCollisionMargin({ version: '1.21.8' }), false)
})

test('action initialization configures the same physics object used by the navigator', () => {
  const bot = botWithDefaults()
  createActions(bot)
  assert.equal(bot.physics.playerHalfWidth, 0.30000003)
})
