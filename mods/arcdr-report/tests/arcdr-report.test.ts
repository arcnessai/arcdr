import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  clip,
  fromTodoWrite,
  limitTokens,
  measureTokens,
  nextTasks,
  relative,
  reportArgs,
  todoTokens,
  toolLine,
} from '../hooks/register'

describe('the tool line', () => {
  test('a file reads relative to the session folder; elsewhere it stays whole', () => {
    expect(toolLine('Edit', { file_path: '/repo/search/rank.ts' }, '/repo')).toBe('Edit search/rank.ts')
    expect(toolLine('Read', { file_path: '/etc/hosts' }, '/repo')).toBe('Read /etc/hosts')
    expect(toolLine('NotebookEdit', { notebook_path: '/repo/a.ipynb' }, '/repo/')).toBe('NotebookEdit a.ipynb')
    expect(relative('/repo', '/repo')).toBe('.')
  })

  test('a command shows its first line; other tools their pattern, query, skill or host', () => {
    expect(toolLine('Bash', { command: 'bun test\necho done' }, '/repo')).toBe('Bash bun test')
    expect(toolLine('Grep', { pattern: 'retry' }, '/repo')).toBe('Grep retry')
    expect(toolLine('WebSearch', { query: 'herdr socket api' }, '/repo')).toBe('WebSearch herdr socket api')
    expect(toolLine('Skill', { skill: 'finish' }, '/repo')).toBe('Skill finish')
    expect(toolLine('WebFetch', { url: 'https://herdr.dev/docs', prompt: 'x' }, '/repo')).toBe('WebFetch herdr.dev')
    expect(toolLine('Agent', { description: 'Find the retry code', prompt: '…' }, '/repo')).toBe('Agent Find the retry code')
    expect(toolLine('mcp__github__get_issue', {}, '/repo')).toBe('github get_issue')
  })

  test('the model keeping its own list leaves the line as it was', () => {
    expect(toolLine('TodoWrite', { todos: [] }, '/repo')).toBeUndefined()
    expect(toolLine('TaskUpdate', { taskId: '1' }, '/repo')).toBeUndefined()
  })

  test('a line is one line of at most 80 characters', () => {
    expect(clip('a\n  b\tc')).toBe('a b c')
    const long = toolLine('Bash', { command: `echo ${'x'.repeat(200)}` }, '/repo')!
    expect(long.length).toBe(80)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('the to-do list', () => {
  const todos = [
    { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
    { content: 'Write the tests', status: 'in_progress', activeForm: 'Writing the tests' },
    { content: 'Land it', status: 'pending', activeForm: 'Landing it' },
  ]

  test('TodoWrite: done over total, and the item in progress in its -ing form', () => {
    expect(todoTokens(fromTodoWrite(todos), false)).toEqual({ todo: '1/3', todoNow: 'Writing the tests' })
  })

  test('a finished list shows while the turn runs and goes once it ends; an unfinished one stays', () => {
    const done = fromTodoWrite(todos.map(t => ({ ...t, status: 'completed' })))
    expect(todoTokens(done, false)).toEqual({ todo: '3/3', todoNow: undefined })
    expect(todoTokens(done, true)).toEqual({ todo: undefined, todoNow: undefined })
    expect(todoTokens(fromTodoWrite(todos), true)).toEqual({ todo: '1/3', todoNow: 'Writing the tests' })
    expect(todoTokens([], false)).toEqual({ todo: undefined, todoNow: undefined })
  })

  test('the Task tools: ids from the answers, updates by id, a listing replaces what was known', () => {
    let tasks = nextTasks(new Map(), 'TaskCreate', { subject: 'Read', description: '' }, { task: { id: '1', subject: 'Read' } })!
    tasks = nextTasks(tasks, 'TaskCreate', { subject: 'Test', description: '', activeForm: 'Testing' }, { task: { id: '2', subject: 'Test' } })!
    tasks = nextTasks(tasks, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true, taskId: '1', updatedFields: [] })!
    tasks = nextTasks(tasks, 'TaskUpdate', { taskId: '2', status: 'in_progress' }, { success: true, taskId: '2', updatedFields: [] })!
    expect(todoTokens([...tasks.values()], false)).toEqual({ todo: '1/2', todoNow: 'Testing' })

    expect(nextTasks(tasks, 'TaskUpdate', { taskId: '2', status: 'completed' }, { success: false })).toBeUndefined()
    const deleted = nextTasks(tasks, 'TaskUpdate', { taskId: '1', status: 'deleted' }, { success: true })!
    expect([...deleted.keys()]).toEqual(['2'])

    const listed = nextTasks(tasks, 'TaskList', {}, { tasks: [{ id: '2', subject: 'Test', status: 'completed', blockedBy: [] }] })!
    expect([...listed.values()]).toEqual([{ text: 'Test', doing: 'Testing', status: 'completed' }])
    expect(nextTasks(tasks, 'Bash', { command: 'ls' }, 'out')).toBeUndefined()
  })
})

describe('measures', () => {
  test('context and cost only when the host has them', () => {
    expect(measureTokens({ window: 200000, percent: 41.6 }, { usd: 1.234 })).toEqual({ context: '42', cost: '1.23' })
    expect(measureTokens({ window: 200000 }, undefined)).toEqual({})
  })

  test('usage windows: percent and reset time; a missing window clears its tokens', () => {
    expect(limitTokens([{ kind: 'five_hour', percentUsed: 31.6, resetsAt: '2026-10-14T18:00:00Z' }])).toEqual({
      limit5h: '32',
      limit5hReset: '2026-10-14T18:00:00Z',
      limitWeek: undefined,
      limitWeekReset: undefined,
    })
  })
})

describe('reports', () => {
  test('only what changed: new and changed values sent, gone ones cleared', () => {
    expect(reportArgs({ tool: 'Edit a.ts', context: '40', todo: undefined }, { tool: 'Read a.ts', context: '40', todo: '1/3' })).toEqual([
      '--token',
      'tool=Edit a.ts',
      '--clear-token',
      'todo',
    ])
    expect(reportArgs({ context: '40' }, { context: '40' })).toEqual([])
    expect(reportArgs({ tool: 'Bash a=b' }, {})).toEqual(['--token', 'tool=Bash a=b'])
  })
})

const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// The engine beneath the mod: a session in /repo on branch main, with a herdr that records each report.
function engine(on: On, env: Record<string, string> = { HERDR_PANE_ID: 'w1:p1', HERDR_BIN_PATH: '/bin/herdr' }) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, percent: 12 }, rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-14T18:00:00Z' }] },
  }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('tool.call', ($, e) =>
    e.tool === 'TaskCreate' ? { result: { task: { id: '7', subject: 'Write the tests' } } } : { result: 'ok' },
  )
  mock.env(on, env)
  const clock = mock.clock(on, { now: 1_000_000 })
  const reports: string[][] = []
  on('process.run', ($, e) => {
    if (e.argv[0] === 'git') return { value: { ...RAN, stdout: 'main\n' } }
    reports.push(e.argv.slice(6).map(String))
    return { value: { ...RAN, stdout: '' } }
  })
  return { clock, reports }
}

describe('a session in a herdr pane', () => {
  test('reports its measures and branch at start, clearing what an earlier run left', async ($, on) => {
    const { clock, reports } = engine(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.advance(600)
    expect(reports).toEqual([
      [
        '--token',
        'context=12',
        '--token',
        'limit5h=20',
        '--token',
        'limit5hReset=2026-10-14T18:00:00Z',
        '--token',
        'branch=main',
        '--clear-token',
        'tool',
        '--clear-token',
        'turnStart',
        '--clear-token',
        'todo',
        '--clear-token',
        'todoNow',
      ],
    ])
  })

  test('a burst of calls is one report with the last call; the end of the turn clears the moment', async ($, on) => {
    const { clock, reports } = engine(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.advance(600)
    reports.length = 0

    await $.turn.start({ text: 'fix it', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Write the tests', description: '', activeForm: 'Writing the tests' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' } as never)
    await $.tool.call({ tool: 'Bash', command: 'bun test' } as never)
    // A subagent's call is its own work.
    await $.tool.call({ tool: 'Edit', file_path: '/repo/b.ts', old_string: 'a', new_string: 'b', agentId: 'sub1' } as never)
    await clock.advance(600)
    expect(reports).toEqual([
      ['--token', 'turnStart=1000600', '--token', 'todo=0/1', '--token', 'todoNow=Writing the tests', '--token', 'tool=Bash bun test'],
    ])

    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(600)
    expect(reports.at(-1)).toEqual(['--clear-token', 'turnStart', '--clear-token', 'tool'])
  })

  test('leaving clears every token it reported', async ($, on) => {
    const { clock, reports } = engine(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.advance(600)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } } as never)
    expect(reports.at(-1)).toEqual([
      '--clear-token',
      'context',
      '--clear-token',
      'limit5h',
      '--clear-token',
      'limit5hReset',
      '--clear-token',
      'branch',
    ])
  })

  test('an unattended run, or one outside herdr, reports nothing', async ($, on) => {
    const { clock, reports } = engine(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await clock.advance(600)
    expect(reports).toEqual([])
  })

  test('without HERDR_PANE_ID nothing is sent', async ($, on) => {
    const { clock, reports } = engine(on, {})
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await clock.advance(600)
    expect(reports).toEqual([])
  })
})
