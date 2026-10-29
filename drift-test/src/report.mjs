// Pass rates, the win rules fixed before the run, and the Markdown report.

// Win rules, fixed before the first real run: whichlib needs these margins (in points of pass rate).
export const WIN_RULES = { vsAlone: 20, vsContext7: 10 }

const round1 = (n) => Math.round(n * 10) / 10

export function summarize(results, setups) {
  const bySetup = {}
  for (const id of setups) {
    // Errors (usage limit, failed install) say nothing about the setup, so rates leave them out.
    const rows = results.filter((r) => r.setup === id && r.outcome !== 'error')
    const errors = results.filter((r) => r.setup === id && r.outcome === 'error').length
    const passed = rows.filter((r) => r.pass).length
    bySetup[id] = { passed, total: rows.length, errors, rate: rows.length ? round1((passed / rows.length) * 100) : 0 }
  }
  return { bySetup, verdict: verdict(bySetup) }
}

function verdict(bySetup) {
  const { alone, context7, whichlib } = bySetup
  if (!alone || !context7 || !whichlib) return { outcome: 'incomplete' }
  const vsAlone = round1(whichlib.rate - alone.rate)
  const vsContext7 = round1(whichlib.rate - context7.rate)
  let outcome = 'stop'
  if (vsAlone >= WIN_RULES.vsAlone && vsContext7 >= WIN_RULES.vsContext7) outcome = 'clear-win'
  else if (vsAlone >= WIN_RULES.vsAlone) outcome = 'use-with-context7'
  return { outcome, vsAlone, vsContext7 }
}

const pts = (n) => `${n > 0 ? '+' : ''}${round1(n)} pts`

function usage(rows) {
  const withTokens = rows.filter((r) => r.tokens)
  const tokens = withTokens.reduce((sum, r) => sum + (r.tokens.input ?? 0) + (r.tokens.output ?? 0), 0)
  const seconds = rows.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / 1000
  return {
    avgTokens: withTokens.length ? Math.round(tokens / withTokens.length) : null,
    avgSeconds: rows.length ? round1(seconds / rows.length) : null,
  }
}

function verdictText(v, bySetup) {
  const rule = `(needs ${pts(WIN_RULES.vsAlone)} vs agent alone and ${pts(WIN_RULES.vsContext7)} vs Context7)`
  const margins = `whichlib is ${pts(v.vsAlone ?? 0)} vs agent alone and ${pts(v.vsContext7 ?? 0)} vs Context7 ${rule}`
  switch (v.outcome) {
    case 'clear-win':
      return `**Clear win.** ${margins}.`
    case 'use-with-context7': {
      const both = bySetup.both
      const bothLine = both
        ? ` Context7 + whichlib passes ${both.rate}% (${pts(both.rate - bySetup.context7.rate)} vs Context7 alone).`
        : ' Run the "both" setup to measure Context7 + whichlib.'
      return `**Beats only the agent alone: use with Context7.** ${margins}.${bothLine}`
    }
    case 'stop':
      return `**Stop and rethink.** ${margins}.`
    default:
      return '**No verdict.** The win rules compare the setups alone, context7 and whichlib; this run did not include all three.'
  }
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

export function renderReport(run) {
  const { summary, setups, results } = run
  const models = [...new Set(results.map((r) => r.model).filter(Boolean))]
  const lines = [
    '# Drift Test report',
    '',
    `Run ${run.startedAt} to ${run.finishedAt}. Model: ${models.join(', ') || 'unknown'}. ` +
      `${run.tasks} tasks, setups: ${setups.join(', ')}.`,
    '',
    'Pass or fail is decided only by each task\'s type checker and tests. ' +
      'Errors (usage limit, failed install, agent crash before any edit) are not counted in pass rates.',
    ...(run.reruns ?? []).map((r) => {
      const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`
      return `\n${n(r.rerun, 'error')} rerun on ${r.at}; ${n(r.stillErrors, 'error')} left after the rerun.`
    }),
    '',
    '## Pass rate per setup',
    '',
    '| Setup | Passed | Pass rate | vs alone | vs Context7 | Errors | Avg tokens | Avg time |',
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const id of setups) {
    const s = summary.bySetup[id]
    const vs = (other) => (other === id || !summary.bySetup[other] ? '—' : pts(s.rate - summary.bySetup[other].rate))
    const u = usage(results.filter((r) => r.setup === id))
    lines.push(
      `| ${id} | ${s.passed}/${s.total} | ${s.rate}% | ${vs('alone')} | ${vs('context7')} | ${s.errors} | ` +
        `${u.avgTokens ?? '—'} | ${u.avgSeconds === null ? '—' : u.avgSeconds + ' s'} |`,
    )
  }
  lines.push('', '## Verdict', '', verdictText(summary.verdict, summary.bySetup), '')

  lines.push('## Per task', '', `| Task | Library | ${setups.join(' | ')} |`, `|---|---|${setups.map(() => '---|').join('')}`)
  for (const task of [...new Set(results.map((r) => r.task))]) {
    const rows = results.filter((r) => r.task === task)
    const marks = setups.map((id) => {
      const r = rows.find((x) => x.setup === id)
      return r ? r.outcome : '—'
    })
    lines.push(`| ${task} | ${rows[0].library} | ${marks.join(' | ')} |`)
  }

  for (const [title, outcome] of [['Failures', 'fail'], ['Errors', 'error']]) {
    const rows = results.filter((r) => r.outcome === outcome)
    if (!rows.length) continue
    lines.push('', `## ${title}`, '')
    for (const r of rows) lines.push(`- ${r.task} / ${r.setup}: ${cell(r.reason)}`)
  }
  return lines.join('\n') + '\n'
}
