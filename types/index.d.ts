export type Phase = 'idle' | 'working' | 'done'
export type Status = 'pending' | 'in_progress' | 'completed'
export type View = {
  phase: Phase
  plan: Status[]
  tick: number
  doneTick: number
  seed: number
  prevFrac: number
  planTick: number
}
declare module 'claude-code' {
  interface PluginState { 'pixel-progress': { view: View } }
}
