import { afterEach, describe, expect, it, vi } from 'vitest'
import { Logger } from '../src/logger.js'

afterEach(() => vi.restoreAllMocks())

describe('Logger terminal output', () => {
  it('strips terminal controls and prevents injected log lines', () => {
    const output: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message) => { output.push(String(message)) })
    const logger = new Logger('info')
    logger.write('info', 'remote', '\u001B]0;bad title\u0007hello\r\n[FAKE] forged')
    expect(output).toHaveLength(1)
    expect(output[0]).not.toContain('\u001B')
    expect(output[0]).not.toContain('\u0007')
    expect(output[0]).not.toContain('\n[FAKE]')
    expect(output[0]).toContain('hello [FAKE] forged')
  })
})
