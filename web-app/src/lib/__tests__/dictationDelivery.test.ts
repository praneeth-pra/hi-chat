import { beforeEach, describe, expect, it } from 'vitest'
import { usePrompt } from '@/hooks/usePrompt'
import {
  deliverDictation,
  deliverDictationPaste,
  useDictationDelivery,
} from '../dictationDelivery'

beforeEach(() => {
  usePrompt.getState().resetPrompt()
  useDictationDelivery.setState({ pending: [] })
})
describe('dictation prompt delivery', () => {
  it('preserves typed input and puts recognized words in the prompt for automatic sending', () => {
    usePrompt.getState().setPrompt('Explain')
    deliverDictation('ECS pricing.')
    expect(usePrompt.getState().prompt).toBe('Explain ECS pricing.')
    expect(useDictationDelivery.getState().pending).toEqual([
      'Explain ECS pricing.',
    ])
  })
  it('combines repeated dictation waiting on an answer without sending earlier words twice', () => {
    deliverDictation('Explain ECS.')
    deliverDictation('Compare it with EKS.')
    expect(useDictationDelivery.getState().pending).toEqual([
      'Explain ECS. Compare it with EKS.',
    ])
  })
  it('queues external pasted dictation as-is while leaving the typed draft alone', () => {
    usePrompt.getState().setPrompt('My typed draft')
    useDictationDelivery.setState({ pending: [] })
    deliverDictationPaste(' Explain DNS. ')
    expect(usePrompt.getState().prompt).toBe('My typed draft')
    expect(useDictationDelivery.getState().pending).toEqual(['Explain DNS.'])
  })
})
