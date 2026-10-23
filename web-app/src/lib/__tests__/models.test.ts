import { describe, it, expect } from 'vitest'
import {
  defaultModel,
  extractDescription,
  removeYamlFrontMatter,
  extractModelName,
  extractModelRepo,
  getModelCapabilities,
} from '../models'
import { ModelCapabilities } from '@/types/models'

describe('defaultModel', () => {
  it('returns the first Groq model when no provider is given', () => {
    expect(defaultModel()).toBe('openai/gpt-oss-120b')
    expect(defaultModel('')).toBe('openai/gpt-oss-120b')
  })

  it('falls back to Groq for an unknown provider', () => {
    expect(defaultModel('unknown')).toBe('openai/gpt-oss-120b')
  })

  it('returns the first model of a built-in provider', () => {
    expect(defaultModel('cerebras')).toBe('gpt-oss-120b')
  })
})

describe('extractDescription', () => {
  it('returns undefined for falsy input', () => {
    expect(extractDescription()).toBeUndefined()
    expect(extractDescription('')).toBe('')
  })

  it('extracts overview section from markdown', () => {
    const markdown = `# Model Title
## Overview
This is the model overview section.
It has multiple lines.
## Features
This is another section.`

    expect(extractDescription(markdown)).toBe(
      'This is the model overview section.\nIt has multiple lines.'
    )
  })

  it('falls back to first 500 characters when no overview section', () => {
    const longText = 'A'.repeat(600)
    expect(extractDescription(longText)).toBe('A'.repeat(500))
  })

  it('removes YAML front matter before extraction', () => {
    const markdownWithYaml = `---
title: Model
author: Test
---
# Model Title
## Overview
This is the overview.`

    expect(extractDescription(markdownWithYaml)).toBe('This is the overview.')
  })

  it('removes image markdown syntax', () => {
    const markdownWithImages = `## Overview
This is text with ![alt text](image.png) image.
More text here.`

    expect(extractDescription(markdownWithImages)).toBe(
      'This is text with  image.\nMore text here.'
    )
  })

  it('removes HTML img tags', () => {
    const markdownWithHtmlImages = `## Overview
This is text with <img src="image.png" alt="alt"> image.
More text here.`

    expect(extractDescription(markdownWithHtmlImages)).toBe(
      'This is text with  image.\nMore text here.'
    )
  })

  it('handles text without overview section', () => {
    const simpleText = 'This is a simple description without sections.'
    expect(extractDescription(simpleText)).toBe(
      'This is a simple description without sections.'
    )
  })

  it('extracts overview that ends at file end', () => {
    const markdown = `# Model Title
## Overview
This is the overview at the end.`

    expect(extractDescription(markdown)).toBe(
      'This is the overview at the end.'
    )
  })
})

describe('removeYamlFrontMatter', () => {
  it('removes YAML front matter from content', () => {
    const contentWithYaml = `---
title: Test
author: John
---
# Main Content
This is the main content.`

    const expected = `# Main Content
This is the main content.`

    expect(removeYamlFrontMatter(contentWithYaml)).toBe(expected)
  })

  it('returns content unchanged when no YAML front matter', () => {
    const content = `# Main Content
This is the main content.`

    expect(removeYamlFrontMatter(content)).toBe(content)
  })

  it('handles empty content', () => {
    expect(removeYamlFrontMatter('')).toBe('')
  })

  it('handles content with only YAML front matter', () => {
    const yamlOnly = `---
title: Test
author: John
---
`

    expect(removeYamlFrontMatter(yamlOnly)).toBe('')
  })

  it('does not remove YAML-like content in middle of text', () => {
    const content = `# Title
Some content here.
---
This is not front matter
---
More content.`

    expect(removeYamlFrontMatter(content)).toBe(content)
  })
})

describe('extractModelName', () => {
  it('extracts model name from repo path', () => {
    expect(extractModelName('cortexso/tinyllama')).toBe('tinyllama')
    expect(extractModelName('microsoft/DialoGPT-medium')).toBe(
      'DialoGPT-medium'
    )
    expect(extractModelName('huggingface/CodeBERTa-small-v1')).toBe(
      'CodeBERTa-small-v1'
    )
  })

  it('returns the input when no slash is present', () => {
    expect(extractModelName('tinyllama')).toBe('tinyllama')
    expect(extractModelName('single-model-name')).toBe('single-model-name')
  })

  it('handles undefined input', () => {
    expect(extractModelName()).toBeUndefined()
  })

  it('handles empty string', () => {
    expect(extractModelName('')).toBe('')
  })

  it('handles multiple slashes', () => {
    expect(extractModelName('org/sub/model')).toBe('sub')
  })
})

describe('extractModelRepo', () => {
  it('extracts repo path from HuggingFace URL', () => {
    expect(extractModelRepo('https://huggingface.co/cortexso/tinyllama')).toBe(
      'cortexso/tinyllama'
    )
    expect(
      extractModelRepo('https://huggingface.co/microsoft/DialoGPT-medium')
    ).toBe('microsoft/DialoGPT-medium')
  })

  it('returns input unchanged when not a HuggingFace URL', () => {
    expect(extractModelRepo('cortexso/tinyllama')).toBe('cortexso/tinyllama')
    expect(extractModelRepo('https://github.com/user/repo')).toBe(
      'https://github.com/user/repo'
    )
  })

  it('handles undefined input', () => {
    expect(extractModelRepo()).toBeUndefined()
  })

  it('handles empty string', () => {
    expect(extractModelRepo('')).toBe('')
  })

  it('handles URLs with trailing slashes', () => {
    expect(extractModelRepo('https://huggingface.co/cortexso/tinyllama/')).toBe(
      'cortexso/tinyllama/'
    )
  })
})

describe('getModelCapabilities', () => {
  it('marks Groq\'s Llama 4 models as seeing images', () => {
    expect(
      getModelCapabilities(
        'groq',
        'meta-llama/llama-4-scout-17b-16e-instruct'
      )
    ).toEqual([ModelCapabilities.COMPLETION, ModelCapabilities.VISION])
  })

  it('gives plain completion to other models and unknown providers', () => {
    expect(getModelCapabilities('groq', 'openai/gpt-oss-120b')).toEqual([
      ModelCapabilities.COMPLETION,
    ])
    expect(getModelCapabilities('cerebras', 'gpt-oss-120b')).toEqual([
      ModelCapabilities.COMPLETION,
    ])
    expect(getModelCapabilities('unknown', 'x')).toEqual([
      ModelCapabilities.COMPLETION,
    ])
  })
})
