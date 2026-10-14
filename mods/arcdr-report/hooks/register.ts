import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit, Timer } from 'claude-code'

import type { TodoItem, TodoStatus, Tokens } from '../types'

// Reports what this session is doing to herdr as pane tokens, so a screen that is not this terminal —
// arcdr on a phone — can show it. Nothing is drawn here and nothing is written but herdr's metadata.

const SOURCE = 'arcdr-report'
// A burst of tool calls becomes one report, the last value winning.
const DEBOUNCE_MS = 500
const MAX_TEXT = 80

// Tokens about a moment rather than the session: cleared when it passes, and at start, in case an earlier
// run in this pane left them behind.
const PASSING = ['tool', 'turnStart', 'todo', 'todoNow'] as const

// Bookkeeping the model does for itself: what the session is doing is still the call before it.
const QUIET = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'ToolSearch'])

const STATUSES = new Set<string>(['pending', 'in_progress', 'completed'])

/** One line, at most `max` characters. */
export const clip = (text: string, max = MAX_TEXT): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/** A path under the session's folder reads relative to it; any other stays whole. */
export const relative = (path: string, cwd: string): string => {
  if (path === cwd) return '.'
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

const hostOf = (url: string | undefined): string | undefined => {
  if (!url) return undefined
  try {
    return new URL(url).host || undefined
  } catch {
    return undefined
  }
}

/**
 * What a call is doing, short: "Edit search/rank.ts", "Bash bun test", "Grep retry". Undefined for the
 * model's own bookkeeping, which leaves the line as it was.
 */
export const toolLine = (tool: string, input: Record<string, unknown>, cwd: string): string | undefined => {
  if (QUIET.has(tool)) return undefined
  const path = text(input.file_path) ?? text(input.notebook_path)
  if (path) return clip(`${tool} ${relative(path, cwd)}`)
  if (tool === 'Bash') {
    const command = text(input.command)
    return clip(command ? `Bash ${command.trim().split('\n')[0]}` : 'Bash')
  }
  const name = tool.startsWith('mcp__') ? tool.slice('mcp__'.length).split('__').join(' ') : tool
  const detail =
    text(input.pattern) ?? text(input.query) ?? text(input.skill) ?? text(input.description) ?? hostOf(text(input.url))
  return clip(detail ? `${name} ${detail}` : name)
}

const statusOf = (value: unknown): TodoStatus | undefined =>
  typeof value === 'string' && STATUSES.has(value) ? (value as TodoStatus) : undefined

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/** The list as TodoWrite wrote it; undefined for anything that is not one. */
export const fromTodoWrite = (todos: unknown): TodoItem[] | undefined => {
  if (!Array.isArray(todos)) return undefined
  return todos.flatMap(raw => {
    const item = record(raw)
    const status = statusOf(item?.status)
    const content = text(item?.content)
    return item && status && content ? [{ text: content, doing: text(item.activeForm), status }] : []
  })
}

/**
 * The Task tools' list after one of their calls answered, by task id; undefined when the call was not
 * one of them. Ids come from the answers, since TaskCreate's input carries none.
 */
export const nextTasks = (
  tasks: ReadonlyMap<string, TodoItem>,
  tool: string,
  input: Record<string, unknown>,
  result: unknown,
): Map<string, TodoItem> | undefined => {
  const answer = record(result)
  const next = new Map(tasks)
  if (tool === 'TaskCreate') {
    const id = text(record(answer?.task)?.id)
    const subject = text(input.subject)
    if (!id || !subject) return undefined
    next.set(id, { text: subject, doing: text(input.activeForm), status: 'pending' })
    return next
  }
  if (tool === 'TaskUpdate') {
    const id = text(input.taskId)
    if (!id || answer?.success === false) return undefined
    if (input.status === 'deleted') {
      next.delete(id)
      return next
    }
    const known = next.get(id)
    const subject = text(input.subject) ?? known?.text
    if (!subject) return undefined
    next.set(id, {
      text: subject,
      doing: text(input.activeForm) ?? known?.doing,
      status: statusOf(input.status) ?? known?.status ?? 'pending',
    })
    return next
  }
  if (tool === 'TaskList') {
    if (!Array.isArray(answer?.tasks)) return undefined
    const listed = new Map<string, TodoItem>()
    for (const raw of answer.tasks) {
      const task = record(raw)
      const id = text(task?.id)
      const subject = text(task?.subject)
      const status = statusOf(task?.status)
      if (id && subject && status) listed.set(id, { text: subject, doing: tasks.get(id)?.doing, status })
    }
    return listed
  }
  if (tool === 'TaskGet') {
    const task = record(answer?.task)
    const id = text(task?.id)
    const subject = text(task?.subject)
    const status = statusOf(task?.status)
    if (!id || !subject || !status) return undefined
    next.set(id, { text: subject, doing: tasks.get(id)?.doing, status })
    return next
  }
  return undefined
}

/**
 * "3/7" and the item in progress. A list whose every item is done shows "7/7" while the turn still runs
 * and goes once it ends: by then it says nothing the conversation does not.
 */
export const todoTokens = (items: readonly TodoItem[] | undefined, isTurnOver: boolean): Tokens => {
  if (!items || items.length === 0) return { todo: undefined, todoNow: undefined }
  const done = items.filter(item => item.status === 'completed').length
  if (done === items.length && isTurnOver) return { todo: undefined, todoNow: undefined }
  const now = items.find(item => item.status === 'in_progress')
  return { todo: `${done}/${items.length}`, todoNow: now ? clip(now.doing ?? now.text) : undefined }
}

/** The context window's fill and the session's cost, each only when the host has a figure for it. */
export const measureTokens = (context: SessionContextUsage | undefined, cost: SessionCost | undefined): Tokens => ({
  ...(context?.percent === undefined ? {} : { context: String(Math.round(context.percent)) }),
  ...(cost === undefined ? {} : { cost: cost.usd.toFixed(2) }),
})

/** Each usage window's percent used and when it resets (an ISO time; the reader counts down). */
export const limitTokens = (windows: readonly SessionRateLimit[]): Tokens => {
  const five = windows.find(w => w.kind === 'five_hour')
  const week = windows.find(w => w.kind === 'seven_day')
  return {
    limit5h: five ? String(Math.round(five.percentUsed)) : undefined,
    limit5hReset: five?.resetsAt ?? undefined,
    limitWeek: week ? String(Math.round(week.percentUsed)) : undefined,
    limitWeekReset: week?.resetsAt ?? undefined,
  }
}

/** The flags of one report that brings herdr from `sent` to `wanted`; empty when nothing changed. */
export const reportArgs = (wanted: Tokens, sent: Tokens): string[] => {
  const names = [...new Set([...Object.keys(wanted), ...Object.keys(sent)])]
  return names
    .filter(name => wanted[name] !== sent[name])
    .flatMap(name => {
      const value = wanted[name]
      return value === undefined ? ['--clear-token', name] : ['--token', `${name}=${value}`]
    })
}

// The module's own variables start over on a reload, and session.start runs again then: nothing here
// needs to outlive it.
let pane: string | undefined
let herdr = 'herdr'
// An unattended `claude -p` job started from a herdr tab carries that tab's HERDR_PANE_ID: it must not
// write over the person's pane.
let isReporting = false
let cwd = '/'
let wanted: Tokens = {}
let sent: Tokens = {}
let list: TodoItem[] | undefined
let tasks = new Map<string, TodoItem>()
let isTurnOver = true
let timer: Timer | null = null
let isFlushing = false

const set = ($: EngineInterface, tokens: Tokens) => {
  wanted = { ...wanted, ...tokens }
  schedule($)
}

const schedule = ($: EngineInterface) => {
  if (!isReporting || timer) return
  timer = $.clock.after(DEBOUNCE_MS, () => {
    timer = null
    void flush($)
  })
}

// One process for every change since the last report, carrying only the tokens that changed.
const flush = async ($: EngineInterface) => {
  if (!isReporting || !pane) return
  if (isFlushing) return schedule($)
  const args = reportArgs(wanted, sent)
  if (args.length === 0) return
  const sending = { ...wanted }
  isFlushing = true
  try {
    const ran = await $.process.run([herdr, 'pane', 'report-metadata', pane, '--source', SOURCE, ...args], {
      timeoutMs: 5000,
    })
    // A refused report is sent again with the next change.
    if (ran.exitCode === 0) sent = sending
  } catch {
    // herdr is gone or slow: the same.
  } finally {
    isFlushing = false
  }
}

const branchOf = async ($: EngineInterface): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(['git', 'branch', '--show-current'], { cwd, timeoutMs: 3000 })
    return ran.exitCode === 0 ? clip(ran.stdout) || undefined : undefined
  } catch {
    return undefined
  }
}

// What a new folder, branch or checkout says, read after the hook that asked has returned.
const refresh = async ($: EngineInterface) => {
  cwd = await $.session.cwd()
  set($, { branch: await branchOf($) })
}

const begin = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  set($, { ...measureTokens(usage.context, usage.cost), ...limitTokens(usage.rateLimits) })
  await refresh($)
}

const noteList = ($: EngineInterface, tool: string, input: Record<string, unknown>, result: unknown) => {
  if (tool === 'TodoWrite') {
    list = fromTodoWrite(input.todos)
  } else {
    const next = nextTasks(tasks, tool, input, result)
    if (!next) return
    tasks = next
    list = [...tasks.values()]
  }
  set($, todoTokens(list, isTurnOver))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    pane = await $.env.get('HERDR_PANE_ID')
    isReporting = e.isInteractive && pane !== undefined && pane !== ''
    if (!isReporting) return result
    herdr = (await $.env.get('HERDR_BIN_PATH')) || 'herdr'
    cwd = result.cwd
    wanted = {}
    sent = Object.fromEntries(PASSING.map(name => [name, '']))
    list = undefined
    tasks = new Map()
    isTurnOver = true
    // Read after the start, so the first prompt never waits on git or herdr.
    $.clock.after(0, () => void begin($))
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (isReporting && e.agentId === undefined) {
      isTurnOver = false
      set($, { turnStart: String(await $.clock.now()), ...todoTokens(list, false) })
      $.clock.after(0, () => void refresh($))
    }
    return next(e)
  })

  // Every tool, the main loop's alone: a subagent's calls are its own work, under its own Agent line.
  on('tool.call', async ($, e, next) => {
    if (!isReporting || e.agentId !== undefined) return next(e)
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const line = toolLine(tool, input, cwd)
    if (line !== undefined) set($, { tool: line })
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) noteList($, tool, input, ran.result)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (isReporting && e.agentId === undefined) {
      isTurnOver = true
      set($, { tool: undefined, turnStart: undefined, ...todoTokens(list, true) })
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    // A measurement before the first response carries no windows: the last reading stands.
    if (isReporting) {
      set($, { ...measureTokens(e.context, e.cost), ...(e.rateLimits.length > 0 ? limitTokens(e.rateLimits) : {}) })
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (isReporting) {
      timer?.cancel()
      timer = null
      if (e.reason === 'clear') {
        // The session goes on with a new conversation: its list and its moment go, its measures stay.
        list = undefined
        tasks = new Map()
        wanted = { ...wanted, ...Object.fromEntries(PASSING.map(name => [name, undefined])) }
        await flush($)
      } else {
        // The session is going: nothing of it is left on the pane.
        wanted = {}
        await flush($)
        isReporting = false
      }
    }
    return next(e)
  })
}
