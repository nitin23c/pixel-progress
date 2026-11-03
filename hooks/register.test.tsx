import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'pixel-progress',
  component: 'AbovePrompt',
  props: { hasSurvey: false, bodyColumns: 12 },
  surface: 'terminal',
} as const

const CELLS = 30
const GREENS = ['#2ea043', '#3fb950', '#56d364', '#7ee787', '#c9ffd4', '#e6ffe9']
const GLOW = ['#1f6f2f', '#2f9d44']
const OCEAN = ['#1f6feb', '#388bfd', '#58a6ff', '#79c0ff', '#d2e8ff', '#eaf4ff']

const turn = { text: '', turnId: 't1' }
const complete = { text: 'ok', turnId: 't1', durationMs: 1, isAborted: false }
const plan = (...statuses: string[]) => ({
  tool: 'mcp__ccd_turn__update_plan',
  items: statuses.map(status => ({ content: 'step', status })),
}) as never

const litCount = async (ui: { findAll: (q: { type: string; text: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Text', text: '■' })).filter(s => GREENS.includes(s.props.color as string)).length

const draw = async ($: { ui: { mount: (p: typeof BAND) => Promise<any> } }) => {
  const ui = await $.ui.mount(BAND)
  const squares = (await ui.findAll({ type: 'Text', text: '■' })).length
  const lit = await litCount(ui)
  await ui.unmount()

  return { squares, lit }
}

const stubEngine = (on: any) => {
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

test('nothing is drawn while idle', async ($, on) => {
  stubEngine(on)

  expect((await draw($)).squares).toBe(0)
})

test('the fill is the share of completed plan steps, never a guess', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)

  expect(await draw($)).toEqual({ squares: CELLS, lit: 0 })

  await $.tool.call(plan('completed', 'in_progress', 'pending', 'pending'))
  expect((await draw($)).lit).toBe(Math.round(CELLS * 0.25))

  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
  expect((await draw($)).lit).toBe(Math.round(CELLS * 0.5))

  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', done: [3, 4] } as never)
  expect((await draw($)).lit).toBe(CELLS)
})

test('TodoWrite counts, and a malformed one is ignored without breaking the call', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)

  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: 'a', status: 'completed', activeForm: 'a' },
    { content: 'b', status: 'pending', activeForm: 'b' },
  ] } as never)
  expect((await draw($)).lit).toBe(CELLS / 2)

  await $.tool.call({ tool: 'TodoWrite', todos: 'nonsense' } as never)
  expect((await draw($)).lit).toBe(CELLS / 2)
})

test('a subagent cannot change the main plan', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))

  await $.tool.call({ ...(plan('completed', 'completed', 'completed') as object), agentId: 'a1' } as never)
  expect((await draw($)).lit).toBe(CELLS / 2)
})

test('a subagent finishing does not end the main bar', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))

  await $.turn.complete({ ...complete, reason: 'answer', agentId: 'a1' } as never)
  expect((await draw($)).lit).toBe(CELLS / 2)
})

test('a finished answer fills every square', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))

  await $.turn.complete({ ...complete, reason: 'answer' } as never)

  const ui = await $.ui.mount(BAND)
  const all = await colors(ui)
  await ui.unmount()
  expect(all).toHaveLength(CELLS)
  expect(all.filter(c => c === '#3d444d')).toHaveLength(0)
})

test('an aborted turn hides the bar instead of showing success', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))

  await $.turn.complete({ ...complete, reason: 'aborted', isAborted: true } as never)
  expect((await draw($)).squares).toBe(0)
})

test('a new turn starts from an empty plan', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'completed'))
  await $.turn.complete({ ...complete, reason: 'answer' } as never)

  await $.turn.start({ ...turn, turnId: 't2' })
  expect(await draw($)).toEqual({ squares: CELLS, lit: 0 })
})

const colors = async (ui: { findAll: (q: { type: string; text: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Text', text: '■' })).map(s => s.props.color as string)

test('steps in progress glow beyond the filled squares', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'in_progress', 'pending', 'pending'))

  const ui = await $.ui.mount(BAND)
  const glowing = (await colors(ui)).filter(c => GLOW.includes(c)).length
  await ui.unmount()

  expect(glowing).toBe(Math.round(CELLS * 0.5) - Math.round(CELLS * 0.25))
})

test('the finish sends a soft wave across the full grid', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))
  await $.turn.complete({ ...complete, reason: 'answer' } as never)

  const ui = await $.ui.mount(BAND)
  const blended = (await colors(ui)).filter(c => !GREENS.slice(0, 4).includes(c)).length
  await ui.unmount()

  expect(blended).toBeGreaterThan(0)
  expect(blended).toBeLessThan(CELLS)
})

test('the theme option changes the palette', { options: { theme: 'ocean' } }, async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'completed'))

  const ui = await $.ui.mount(BAND)
  const all = await colors(ui)
  await ui.unmount()

  expect(all.every(c => OCEAN.includes(c))).toBe(true)
})

test('on desktop the squares are an SVG with the same gap across and down', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  const svg = (await ui.find({ type: 'Svg' }))?.props.source as string
  await ui.unmount()

  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)].map(m => m.slice(1).map(Number))
  const [x0, y0, w, h] = rects[0]
  const gapAcross = rects[1][0] - x0 - w
  const gapDown = rects.find(r => r[1] > y0)![1] - y0 - h

  expect(w).toBe(h)
  expect(gapAcross).toBeGreaterThan(0)
  expect(gapDown).toBe(gapAcross)
  expect(new Set(rects.map(r => r[1])).size).toBe(3)
})

const DESKTOP = { ...BAND, surface: 'desktop' } as never

const shown = async ($: any) => {
  const ui = await $.ui.mount(BAND)
  const n = (await ui.findAll({ type: 'Text', text: '■' })).length
  await ui.unmount()

  return n
}

test('the finished grid disappears after the hold, and a repeated session.start does not speed it up', async ($, on) => {
  stubEngine(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))
  await $.turn.complete({ ...complete, reason: 'answer' } as never)

  await clock.advance(125 * 30)
  expect(await shown($)).toBe(CELLS)

  await clock.advance(125 * 15)
  expect(await shown($)).toBe(0)
})

test('the wave moves across the grid as time passes', async ($, on) => {
  stubEngine(on)
  const clock = mock.clock(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))
  await $.turn.complete({ ...complete, reason: 'answer' } as never)

  const meanBlendedX = async () => {
    const ui = await $.ui.mount(DESKTOP)
    const svg = (await ui.find({ type: 'Svg' }))?.props.source as string
    await ui.unmount()
    const xs = [...svg.matchAll(/x="(\d+)" y="\d+" width="9" height="9" rx="2" fill="(#[0-9a-f]{6})"/g)]
      .filter(m => !GREENS.slice(0, 4).includes(m[2]))
      .map(m => Number(m[1]))

    expect(xs.length).toBeGreaterThan(0)

    return xs.reduce((a, b) => a + b, 0) / xs.length
  }

  await clock.advance(125 * 4)
  const early = await meanBlendedX()
  await clock.advance(125 * 8)
  expect(await meanBlendedX()).toBeGreaterThan(early)
})

test('a plan with null items does not break the call or the bar', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)

  await $.tool.call({ tool: 'TodoWrite', todos: [null, { status: 'completed' }] } as never)
  expect((await draw($)).lit).toBe(CELLS / 2)

  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', done: 5, start: 'x' } as never)
  expect((await draw($)).lit).toBe(CELLS / 2)
})

test('an unknown or inherited theme name falls back to github', { options: { theme: 'constructor' } }, async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'completed'))

  expect((await draw($)).lit).toBe(CELLS)
})

test('a nearly done plan never shows a full grid, and a started one shows a square', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)

  await $.tool.call(plan(...Array(99).fill('completed'), 'pending'))
  expect((await draw($)).lit).toBe(CELLS - 1)

  await $.tool.call(plan('completed', ...Array(99).fill('pending')))
  expect((await draw($)).lit).toBe(1)
})

test('a very narrow terminal gets one column, not an overflowing grid', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)

  const ui = await $.ui.mount({ ...BAND, props: { hasSurvey: false, bodyColumns: 1 } } as never)
  const n = (await ui.findAll({ type: 'Text', text: '■' })).length
  await ui.unmount()

  expect(n).toBe(3)
})

test('refused and errored turns hide the bar like an aborted one', async ($, on) => {
  stubEngine(on)
  for (const reason of ['error', 'refusal'] as const) {
    await $.turn.start(turn)
    await $.tool.call(plan('completed', 'pending'))
    await $.turn.complete({ ...complete, reason, refusal: { category: null, explanation: null } } as never)

    expect(await shown($)).toBe(0)
  }
})

test('the desktop SVG has a viewBox and no fixed size, one rect per cell and an honest alt', async ($, on) => {
  stubEngine(on)
  await $.turn.start(turn)
  await $.tool.call(plan('completed', 'pending'))

  const ui = await $.ui.mount(DESKTOP)
  const found = await ui.find({ type: 'Svg' })
  await ui.unmount()
  const svg = found?.props.source as string

  expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/)
  expect(svg.match(/^<svg [^>]*>/)![0]).not.toMatch(/ (width|height)=/)
  expect((svg.match(/<rect /g) ?? []).length % 3).toBe(0)
  expect(found?.props.alt).toBe('Progress 50%')
})
