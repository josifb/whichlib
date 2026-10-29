// The real agent: Claude Code headless (`claude -p`) with the account's default model.
// Each setup changes only what the agent is given: no MCP servers, the Context7 MCP server
// with its recommended rule, a whichlib version card in the system prompt, or both.

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killTree } from './command.mjs'

export const CONTEXT7_URL = 'https://mcp.context7.com/mcp'

// The example rule from Context7's README ("Add a Rule"), so Context7 is used the way it tells its users to.
export const CONTEXT7_RULE =
  'Always use Context7 when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.'

export function mcpConfig(setup, env = process.env) {
  const mcpServers = {}
  if (setup.context7) {
    mcpServers.context7 = {
      type: 'http',
      url: CONTEXT7_URL,
      ...(env.CONTEXT7_API_KEY ? { headers: { CONTEXT7_API_KEY: env.CONTEXT7_API_KEY } } : {}),
    }
  }
  return { mcpServers }
}

export function claudeArgs({ setup, card, mcpConfigPath, model }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'bypassPermissions',
    '--no-session-persistence',
    // Only the project's own settings: the runner's user settings, plugins and MCP servers stay out.
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--mcp-config', mcpConfigPath,
  ]
  if (model) args.push('--model', model)
  const appended = [setup.context7 && CONTEXT7_RULE, setup.whichlib && card].filter(Boolean)
  if (appended.length) args.push('--append-system-prompt', appended.join('\n\n'))
  return args
}

// Every model the session used (main model and background helpers), from modelUsage when present.
function tokenTotals(out) {
  const perModel = Object.values(out.modelUsage ?? {})
  if (perModel.length) {
    return perModel.reduce(
      (t, m) => ({
        input: t.input + (m.inputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0) + (m.cacheReadInputTokens ?? 0),
        output: t.output + (m.outputTokens ?? 0),
      }),
      { input: 0, output: 0 },
    )
  }
  const u = out.usage ?? {}
  return {
    input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output: u.output_tokens ?? 0,
  }
}

// Turns `claude -p --output-format json` output into the runner's usage record.
export function parseClaudeOutput(stdout) {
  // The result is the last line that parses as JSON; anything printed before it is ignored.
  const out = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .find((v) => v && typeof v === 'object')
  if (!out) throw new Error(`no JSON result from claude: ${stdout.slice(-300).trim() || '(empty output)'}`)
  return {
    tokens: tokenTotals(out),
    costUsd: out.total_cost_usd ?? null,
    model: Object.keys(out.modelUsage ?? {}).join(', ') || null,
    turns: out.num_turns ?? null,
    error: out.is_error ? String(out.result ?? out.subtype ?? 'claude reported an error').slice(0, 300) : undefined,
  }
}

export function createClaudeCodeAgent({ bin = 'claude', model, env = process.env } = {}) {
  return async function claudeCodeAgent({ projectDir, prompt, setup, card, signal }) {
    // The MCP config lives outside the project so the agent and the judge never see it.
    const configDir = await mkdtemp(join(tmpdir(), 'drift-mcp-'))
    const mcpConfigPath = join(configDir, 'mcp.json')
    await writeFile(mcpConfigPath, JSON.stringify(mcpConfig(setup, env)))
    try {
      const stdout = await new Promise((resolve, reject) => {
        const child = spawn(bin, claudeArgs({ setup, card, mcpConfigPath, model }), {
          cwd: projectDir,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
          windowsHide: true,
        })
        let out = ''
        let err = ''
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (c) => (out += c))
        child.stderr.on('data', (c) => (err = (err + c).slice(-2000)))
        const onAbort = () => killTree(child)
        signal?.addEventListener('abort', onAbort, { once: true })
        child.on('error', (e) => reject(new Error(`could not start ${bin}: ${e.message}`)))
        child.on('close', (code) => {
          signal?.removeEventListener('abort', onAbort)
          // A non-zero exit still prints a JSON result when claude itself reports the error.
          if (out.trim()) resolve(out)
          else reject(new Error(`${bin} exited ${code}: ${err.trim().slice(-300) || '(no output)'}`))
        })
        child.stdin.end(prompt)
      })
      return parseClaudeOutput(stdout)
    } finally {
      await rm(configDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
