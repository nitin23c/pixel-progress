import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Status, View } from '../types'

const IDLE: View = { phase: 'idle', plan: [], tick: 0, doneTick: 0, seed: 1, prevFrac: 0, planTick: -99 }
const view = atom({ plugin: 'pixel-progress', key: 'view' } as const, IDLE)

const ROWS = 3
const MARGIN = 2
const TICK_MS = 125
const HOLD_TICKS = 40
const FLASH_TICKS = 6
const WAVE_TICKS = 24
const WAVE_SKEW = 3
const SQUARE = 9
const GAP = 4
const PX_PER_COLUMN = 8.9
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'

type Theme = {
  greens: string[]
  empty: string
  shimmer: string
  glow: [string, string]
  flash: string
  wave: string
  cursor: string
}

const BASE = { empty: '#3d444d', shimmer: '#4b535d', cursor: '#ffffff' }
const THEMES: Record<string, Theme> = {
  github: { ...BASE, greens: ['#2ea043', '#3fb950', '#56d364', '#7ee787'], glow: ['#1f6f2f', '#2f9d44'], flash: '#c9ffd4', wave: '#e6ffe9' },
  ocean: { ...BASE, greens: ['#1f6feb', '#388bfd', '#58a6ff', '#79c0ff'], glow: ['#1b4b91', '#2f6fc4'], flash: '#d2e8ff', wave: '#eaf4ff' },
  sunset: { ...BASE, greens: ['#bf4b00', '#e8741a', '#ff9f43', '#ffc971'], glow: ['#7a3410', '#b0541b'], flash: '#fff0d6', wave: '#fff6e6' },
  neon: { ...BASE, greens: ['#a371f7', '#d2a8ff', '#ff7eb6', '#39e6ff'], glow: ['#5b3a9e', '#8a5bd0'], flash: '#ffffff', wave: '#ffffff' },
}

type PlanCall = {
  tool: string
  todos?: { status: Status }[]
  items?: { status: Status }[]
  advance?: boolean
  done?: number[]
  start?: number
}

const rng = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const layout = (seed: number, cells: number) => {
  const next = rng(seed)
  const order = Array.from({ length: cells }, (_, i) => i)
  for (let i = cells - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const rank: number[] = new Array(cells)
  order.forEach((cell, r) => { rank[cell] = r })
  const shade = Array.from({ length: cells }, () => Math.floor(next() * 4))

  return { rank, shade }
}

const share = (plan: Status[], counted: (s: Status) => boolean) =>
  plan.length === 0 ? 0 : plan.filter(counted).length / plan.length

const litCells = (f: number, cells: number) => {
  if (f >= 1) return cells
  if (f <= 0) return 0

  return Math.min(cells - 1, Math.max(1, Math.round(f * cells)))
}

const fraction = (v: View) => (v.phase === 'done' ? 1 : share(v.plan, s => s === 'completed'))

const statusOf = (item: unknown): Status => {
  const status = (item as { status?: unknown } | null)?.status

  return status === 'completed' || status === 'in_progress' ? status : 'pending'
}

const nextPlan = (plan: Status[], call: PlanCall): Status[] => {
  if (call.tool === 'TodoWrite') {
    return Array.isArray(call.todos) ? call.todos.map(statusOf) : plan
  }
  if (call.tool !== PLAN_TOOL) return plan

  const next: Status[] = Array.isArray(call.items) ? call.items.map(statusOf) : [...plan]
  if (call.advance) {
    const i = next.indexOf('in_progress')
    if (i >= 0) next[i] = 'completed'
    const n = next.indexOf('pending')
    if (n >= 0) next[n] = 'in_progress'
  }
  for (const n of Array.isArray(call.done) ? call.done : []) {
    if (typeof n === 'number' && next[n - 1]) next[n - 1] = 'completed'
  }
  if (typeof call.start === 'number' && next[call.start - 1]) next[call.start - 1] = 'in_progress'

  return next
}

const mix = (from: string, to: string, t: number) => {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const out = [1, 3, 5].map(at =>
    Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * t).toString(16).padStart(2, '0'),
  )

  return `#${out.join('')}`
}

type Scene = {
  v: View
  theme: Theme
  cols: number
  lit: number
  litActive: number
  flashFrom: number
}

const colorOf = (s: Scene, i: number, rank: number[], shade: number[]): string => {
  const { v, theme, cols, lit, litActive, flashFrom } = s
  const col = i % cols
  const r = rank[i]

  if (r < lit) {
    if (v.phase === 'done') {
      const elapsed = v.tick - v.doneTick
      if (elapsed < WAVE_TICKS) {
        const crest = (elapsed / WAVE_TICKS) * (cols + ROWS * WAVE_SKEW + 20) - 2
        const delta = crest - (col + Math.floor(i / cols) * WAVE_SKEW)
        const strength = delta >= 0 ? Math.max(0, 1 - delta / 14) : Math.max(0, 1 + delta / 4)
        if (strength > 0) return mix(theme.greens[shade[i]], theme.wave, strength)
      }
    } else if (r >= flashFrom && v.tick - v.planTick < FLASH_TICKS) {
      return theme.flash
    }

    return theme.greens[shade[i]]
  }
  if (v.phase !== 'working') return theme.empty
  if (r < litActive) return theme.glow[Math.floor(v.tick / 4) % 2]
  if (r === litActive && v.tick % 8 < 4) return theme.cursor
  if (Math.abs(col - ((Math.floor(v.tick / 2) % (cols + 12)) - 4)) <= 1) return theme.shimmer

  return theme.empty
}

const ticker: { timer?: Timer } = {}

const startTicker = ($: EngineInterface) => {
  if (ticker.timer) return
  ticker.timer = $.clock.every(TICK_MS, () => { void advance($) })
}

const stopTicker = () => {
  ticker.timer?.cancel()
  ticker.timer = undefined
}

// the clock only runs while the grid is on screen
const advance = async ($: EngineInterface) => {
  if ((await read($, view)).phase === 'idle') return stopTicker()
  await update($, view, x =>
    x.phase === 'done' && x.tick - x.doneTick >= HOLD_TICKS
      ? { ...IDLE, seed: x.seed }
      : { ...x, tick: x.tick + 1 },
  )
  if ((await read($, view)).phase === 'idle') stopTicker()
}

export const register: Register = (on, options) => {
  const key = String(options.theme)
  const theme = Object.prototype.hasOwnProperty.call(THEMES, key) ? THEMES[key] : THEMES.github

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await update($, view, v =>
        v.phase === 'working' ? v : { ...IDLE, phase: 'working', seed: v.seed + 7919 },
      )
      startTicker($)
    }

    return next(e)
  })

  // only the two plan tools reach this hook, and it never blocks one
  on('tool.call', { tool: ['TodoWrite', PLAN_TOOL] }, async ($, e, next) => {
    if (!e.agentId) {
      const call = e as unknown as PlanCall
      try {
        await update($, view, v => {
          const plan = nextPlan(v.plan, call)
          const was = share(v.plan, s => s === 'completed')
          const now = share(plan, s => s === 'completed')

          return now === was ? { ...v, plan } : { ...v, plan, prevFrac: was, planTick: v.tick }
        })
      } catch {
        // an unreadable plan must never stop the tool call
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, view, v =>
        e.reason === 'answer'
          ? { ...v, phase: 'done', doneTick: v.tick }
          : { ...IDLE, seed: v.seed },
      )
    }

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    // after a reload mid-turn the state survives but the timer does not
    if ((await read($, view)).phase !== 'idle') startTicker($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || v.phase === 'idle') return next(e)
    startTicker($)
    const below = await next(e)

    const isDesktop = e.surface === 'desktop'
    const bodyColumns = e.props.bodyColumns || 80
    const cols = isDesktop
      ? Math.max(10, Math.floor((bodyColumns * PX_PER_COLUMN) / (SQUARE + GAP)))
      : Math.max(1, bodyColumns - MARGIN)
    const cells = ROWS * cols
    const { rank, shade } = layout(v.seed, cells)
    const lit = litCells(fraction(v), cells)
    const scene: Scene = {
      v,
      theme,
      cols,
      lit,
      litActive: Math.max(lit, litCells(share(v.plan, s => s !== 'pending'), cells)),
      flashFrom: Math.min(lit, litCells(v.prevFrac, cells)),
    }

    if (e.surface === 'desktop') {
      const { Box, Svg } = $.ui.resolve(e)
      const width = cols * (SQUARE + GAP) - GAP
      const height = ROWS * (SQUARE + GAP) - GAP
      const rects = Array.from({ length: cells }, (_, i) => {
        const x = (i % cols) * (SQUARE + GAP)
        const y = Math.floor(i / cols) * (SQUARE + GAP)

        return `<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" rx="2" fill="${colorOf(scene, i, rank, shade)}"/>`
      }).join('')
      const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${rects}</svg>`

      return (
        <Box flexDirection="column">
          <Svg source={source} alt={`Progress ${Math.floor(fraction(v) * 100)}%`} />
          {below}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const rows = Array.from({ length: ROWS }, (_, r) => (
      <Box key={r}>
        {Array.from({ length: cols }, (_, c) => (
          <Text key={c} color={colorOf(scene, r * cols + c, rank, shade)}>■</Text>
        ))}
      </Box>
    ))

    return <Box flexDirection="column">{rows}{below}</Box>
  })
}
