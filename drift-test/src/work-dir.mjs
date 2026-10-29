// The folder the agent works in. Claude Code loads CLAUDE.md and .claude/CLAUDE.md from every
// parent of its working folder, whatever --setting-sources says, so a project copy under the
// user folder (the Windows temp folder is) picks up ~/.claude/CLAUDE.md. The runner therefore
// works only in a folder with no such file in it or any parent.

import { mkdir, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')]

// The temp folder, unless it sits inside the home folder; then a folder at the home drive's root.
export function defaultWorkDir({ platform = process.platform, home = homedir(), tmp = tmpdir() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix
  const rel = p.relative(home, tmp)
  const insideHome = rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel))
  return insideHome ? p.join(p.parse(home).root, 'drift-work') : p.join(tmp, 'drift-work')
}

// Every instruction file Claude Code would load from dir or one of its parents, nearest first.
async function instructionFilesAbove(dir) {
  const found = []
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    for (const name of INSTRUCTION_FILES) {
      const file = path.join(d, name)
      if (await stat(file).then((s) => s.isFile(), () => false)) found.push(file)
    }
    if (path.dirname(d) === d) return found
  }
}

// Creates the work folder and refuses it when Claude Code would load instructions there.
export async function prepareWorkDir(dir) {
  const found = await instructionFilesAbove(dir)
  if (found.length) {
    throw new Error(
      `work folder ${dir} is below ${found.join(', ')}; Claude Code would load ` +
        `${found.length === 1 ? 'it' : 'them'} into every setup. Pick another folder with --work.`,
    )
  }
  await mkdir(dir, { recursive: true })
  return dir
}
