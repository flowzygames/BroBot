// Execute the shipped wrapper without accepting legal terms or starting a world.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// Own one process group on POSIX; taskkill targets the created wrapper tree on
// Windows. Cleanup failures are recorded as failure, never a successful probe.
export function runLauncherProcess(file, args, options) {
  return new Promise(resolve => {
    const { input, timeout = 180000, maxBuffer = 4 * 1024 * 1024, ...spawnOptions } = options
    let child, timer, cleanupTimer, finished = false, error = null, cleanupError = null, stdout = '', stderr = '', size = 0
    const finish = (status, signal, processExitObserved = true) => {
      if (finished) return
      finished = true
      clearTimeout(timer); clearTimeout(cleanupTimer)
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
      resolve({ status, signal, error, cleanupError, processExitObserved, stdout, stderr })
    }
    const stop = reason => {
      if (error) return
      error = Error(reason)
      if (!child?.pid) return
      try {
        if (process.platform === 'win32') {
          const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000, encoding: 'utf8' })
          if (killed.error || killed.status !== 0) cleanupError = killed.error?.message || `taskkill exited ${killed.status}`
        } else {
          try { process.kill(-child.pid, 'SIGKILL') } catch (failure) { if (failure.code !== 'ESRCH') throw failure }
        }
      } catch (failure) { cleanupError = failure.message }
      cleanupTimer = setTimeout(() => {
        cleanupError ??= 'Process-tree termination could not be confirmed'
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); child.unref()
        finish(null, null, false)
      }, 10000)
    }
    const interrupt = () => stop('Launcher check interrupted')
    const append = (channel, data) => {
      size += Buffer.byteLength(data)
      if (size > maxBuffer) { stop('Launcher output limit exceeded'); return }
      if (channel === 'stdout') stdout += data; else stderr += data
    }
    try { child = spawn(file, args, { ...spawnOptions, stdio: 'pipe', detached: process.platform !== 'win32' }) }
    catch (failure) { resolve({ status: null, signal: null, error: failure, cleanupError, stdout, stderr }); return }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', data => append('stdout', data)); child.stderr.on('data', data => append('stderr', data))
    child.on('error', failure => { error ??= failure })
    child.stdin.on('error', () => {}) // Early exit may close stdin before input is consumed.
    child.stdin.end(input)
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
    timer = setTimeout(() => stop('Launcher check timed out'), timeout)
    child.once('close', (status, signal) => finish(status, signal))
  })
}

export async function checkLauncherRefusal(root, { run = runLauncherProcess, platform = process.platform, env = process.env } = {}) {
  const marker = join(root, 'node_modules', '.brobot-lock.sha256')
  const fresh = ['.env', '.server', '.brobot'].every(path => !existsSync(join(root, path))) && !existsSync(marker)
  if (!fresh) throw Error('Launcher refusal check requires a pristine extracted installation')
  const windows = platform === 'win32'
  const executable = windows ? env.ComSpec || 'cmd.exe' : 'sh'
  const args = windows ? ['/d', '/s', '/c', 'Start-BroBot.cmd'] : ['./start-brobot.sh']
  const child = await run(executable, args, {
    cwd: root, input: windows ? '\r\n' : '\n', encoding: 'utf8', shell: false,
    windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024,
    // Port zero cannot be a running Minecraft listener. Never pass a paid API
    // key into this negative first-launch probe.
    env: { ...env, MC_HOST: '127.0.0.1', MC_PORT: '0', BROBOT_DATA_DIR: join(root, '.brobot'), OPENAI_API_KEY: '' }
  })
  const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`
  const hash = createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex')
  const read = path => { try { return readFileSync(path) } catch { return null } }
  const configuration = read(join(root, '.env')), defaults = read(join(root, '.env.example'))
  const checks = {
    expected_exit: child.status === 1 && !child.error && !child.signal && !child.cleanupError && child.processExitObserved !== false,
    explicit_eula_refusal: output.includes('Minecraft EULA acceptance is required.') && output.includes('https://www.minecraft.net/eula'),
    defaults_created: Boolean(configuration && defaults && configuration.equals(defaults)),
    dependencies_recorded: read(marker)?.toString().trim() === hash,
    no_server_files: !existsSync(join(root, '.server')),
    no_bot_data: !existsSync(join(root, '.brobot')),
    no_world_start: !output.includes('Starting your local world.') && !output.includes('World ready.')
  }
  return {
    command: windows ? 'Start-BroBot.cmd' : 'sh ./start-brobot.sh',
    kind: 'noninteractive_eula_refusal', expectedExitCode: 1, exitCode: child.status,
    signal: child.signal ?? null, error: child.error?.message ?? null, cleanupError: child.cleanupError ?? null,
    passed: Object.values(checks).every(Boolean), checks
  }
}

export async function launcherRefusalRecord(root, options) {
  try { return await checkLauncherRefusal(root, options) }
  catch (error) {
    return { command: 'platform launcher', kind: 'noninteractive_eula_refusal', expectedExitCode: 1,
      exitCode: null, passed: false, error: error.message, checks: {} }
  }
}
