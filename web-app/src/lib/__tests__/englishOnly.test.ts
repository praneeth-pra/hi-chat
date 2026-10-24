import { describe, it, expect } from 'vitest'
import { englishOnly } from '../englishOnly'
import { applyFixes } from '../dictationFixes'

describe('englishOnly', () => {
  it('leaves English alone', () => {
    const text = 'Tell me about your café project, it cost $5 (S3 + EC2).'
    expect(englishOnly(text)).toBe(text)
  })

  it('drops Hindi and Telugu words heard in the background', () => {
    expect(englishOnly('क्या हुआ? Tell me about Kubernetes.')).toBe(
      'Tell me about Kubernetes.'
    )
    expect(englishOnly('How do you scale it? ఏం చేస్తున్నావు')).toBe(
      'How do you scale it?'
    )
    expect(englishOnly('What is RBAC नमस्ते , in AWS?')).toBe(
      'What is RBAC in AWS?'
    )
  })

  it('returns nothing when nothing was English', () => {
    expect(englishOnly('अरे, खाना तैयार है।')).toBe('')
    expect(englishOnly('మీరు ఎలా ఉన్నారు?')).toBe('')
  })

  it('runs with the known fixes on every engine', () => {
    expect(applyFixes('बोलो a CICD pipeline')).toBe('a CI/CD pipeline')
  })
})
