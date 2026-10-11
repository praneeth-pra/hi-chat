import { beforeEach, describe, expect, it } from 'vitest'
import { autoChain, useChatAuto } from '../chatModels'
describe('the two Groq/Cerebras Auto modes', () => {
  beforeEach(() => {
    localStorage.clear()
    useChatAuto.setState({ auto: true, mode: 'accuracy' })
  })
  it('only configures the three requested models', () => {
    expect(autoChain()).toEqual([
      { provider: 'cerebras', model: 'gpt-oss-120b' },
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
      { provider: 'groq', model: 'openai/gpt-oss-20b' },
    ])
  })
  it('keeps mode selection while turning Auto on or off for manual models', () => {
    useChatAuto.getState().setMode('speed')
    useChatAuto.getState().setAuto(false)
    expect(useChatAuto.getState()).toMatchObject({ auto: false, mode: 'speed' })
    useChatAuto.getState().setAuto(true)
    expect(useChatAuto.getState().mode).toBe('speed')
    expect(JSON.parse(localStorage.getItem('chat-auto')!).state).toMatchObject({
      auto: true,
      mode: 'speed',
    })
  })
  it('loads an old Auto preference with Accuracy as its mode', async () => {
    useChatAuto.setState({ auto: true, mode: 'accuracy' })
    localStorage.setItem(
      'chat-auto',
      JSON.stringify({ state: { auto: false }, version: 0 })
    )
    await useChatAuto.persist.rehydrate()
    expect(useChatAuto.getState()).toMatchObject({
      auto: false,
      mode: 'accuracy',
    })
  })
})
