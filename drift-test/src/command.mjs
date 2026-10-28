// Runs one shell command with a deadline, killing the whole process tree on timeout.

import { spawn, spawnSync } from 'node:child_process'

const OUTPUT_TAIL = 4000

export const formatSeconds = (ms) => `${Math.round(ms / 100) / 10} s`

export function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

// A check run from inside `node --test` would otherwise report to the outer runner and always exit 0.
function cleanEnv(env) {
  const { NODE_TEST_CONTEXT, ...rest } = env
  return rest
}

export function runCommand(command, { cwd, timeoutMs, env = process.env }) {
  env = cleanEnv(env)
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    let output = ''
    const collect = (chunk) => {
      output = (output + chunk).slice(-OUTPUT_TAIL)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, why: `could not start: ${err.message}`, output })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) resolve({ ok: false, why: `timed out after ${formatSeconds(timeoutMs)}`, output })
      else if (code === 0) resolve({ ok: true, output })
      else resolve({ ok: false, why: `exited ${code}`, output })
    })
  })
}
