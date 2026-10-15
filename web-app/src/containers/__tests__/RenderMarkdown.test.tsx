import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RenderMarkdown } from '../RenderMarkdown'

vi.mock('@i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../CodeHighlight', () => ({
  default: ({ children }: { children: string }) => (
    <code data-testid="highlighted-code">{children}</code>
  ),
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
})

describe('RenderMarkdown', () => {
  it('draws a flow block as stacked steps that fit a narrow window', () => {
    const { container } = render(
      <RenderMarkdown
        content={'```flow\n1. Test class: calls page methods\n->\nPage Object: holds locators\n- WebDriver\n```'}
      />
    )
    const flow = container.querySelector('[data-flow-diagram]')
    expect(flow).not.toBeNull()
    expect(container.querySelector('[data-code-block]')).toBeNull()
    const steps = flow!.querySelectorAll('.font-semibold')
    expect([...steps].map((s) => s.textContent)).toEqual([
      'Test class',
      'Page Object',
      'WebDriver',
    ])
    expect(flow!.textContent).toContain(': calls page methods')
    expect(flow!.textContent?.match(/↓/g)).toHaveLength(2)
  })

  it('keeps a tree block unwrapped so the folder indentation lines up', () => {
    const tree = 'src/\n  test/\n    java/\n      pages/'
    const { container } = render(
      <RenderMarkdown content={'```tree\n' + tree + '\n```'} />
    )
    const pre = container.querySelector('[data-tree-layout]')
    expect(pre?.className).toContain('whitespace-pre')
    expect(pre?.className).not.toContain('pre-wrap')
    expect(pre?.textContent).toBe(tree)
  })

  it('always displays model comparisons as bullets even with an old disabled setting', () => {
    localStorage.setItem('tables-as-lists', 'off')
    try {
      const { container } = render(
        <RenderMarkdown
          content={
            'Service | Scope | Cost\n--- | --- | ---\n**ECS** | Containers | Low\nEKS | Kubernetes | Higher'
          }
        />
      )
      expect(container.querySelector('table')).toBeNull()
      const items = container.querySelectorAll('li')
      expect(items).toHaveLength(2)
      expect(items[0].textContent).toBe('ECS: Scope: Containers; Cost: Low')
      expect(items[1].textContent).toBe('EKS: Scope: Kubernetes; Cost: Higher')
    } finally {
      localStorage.removeItem('tables-as-lists')
    }
  })

  it('converts nested tables while preserving links, code and escaped pipes', () => {
    const { container } = render(
      <RenderMarkdown
        content={
          '> | Option | Details |\n> | --- | --- |\n> | [VPN](https://example.com) | Use `a\\|b` |'
        }
      />
    )
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('blockquote li')?.textContent).toBe(
      'VPN: Use a|b'
    )
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com'
    )
    expect(container.querySelector('code')?.textContent).toBe('a|b')
  })

  it('keeps header-only streaming tables visible and updates them into row bullets', () => {
    const { container, rerender } = render(
      <RenderMarkdown content={'| Option | Benefit |\n| --- | --- |'} />
    )
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('li')?.textContent).toBe('Option: Benefit')
    rerender(
      <RenderMarkdown
        content={'| Option | Benefit |\n| --- | --- |\n| VPN | Quick setup |'}
      />
    )
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('li')?.textContent).toBe('VPN: Quick setup')
  })

  it('preserves empty first cells without losing other column labels', () => {
    const { container } = render(
      <RenderMarkdown
        content={
          '| Option | Scope | Cost |\n| --- | --- | --- |\n| | Global | Low |'
        }
      />
    )
    expect(container.querySelector('li')?.textContent).toBe(
      'Scope: Global; Cost: Low'
    )
  })

  it('preserves table examples in fenced code and tables in user input', () => {
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const { container, rerender } = render(
      <RenderMarkdown content={'````text\n' + table + '\n````'} />
    )
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('code')?.textContent).toContain('| A | B |')
    rerender(<RenderMarkdown content={table} isUser />)
    expect(container.querySelector('table')).not.toBeNull()
    rerender(<RenderMarkdown content={table} />)
    expect(container.querySelector('table')).toBeNull()
  })

  it('preserves tables in external HTML documents', () => {
    const { container } = render(
      <RenderMarkdown
        enableRawHtml
        content={'<table><tr><td>Documentation</td></tr></table>'}
      />
    )
    expect(container.querySelector('table')?.textContent).toBe('Documentation')
  })

  it('sanitizes external HTML while preserving text and mathematical rendering', () => {
    const { container } = render(
      <RenderMarkdown
        enableRawHtml
        content={
          '<iframe srcdoc="<script>parent.alert(1)</script>"></iframe><img src="https://example.com/x" onerror="alert(1)"><form><input></form><p>Safe text</p>\n\n$\\alpha + \\beta$'
        }
      />
    )
    expect(
      container.querySelector('iframe, script, form, input:not([disabled])')
    ).toBeNull()
    expect(container.querySelector('img')?.hasAttribute('onerror')).toBe(false)
    expect(container.textContent).toContain('Safe text')
    expect(container.querySelector('.katex')).not.toBeNull()
  })
  it('applies raw HTML mode changes when content stays the same', () => {
    const { container, rerender } = render(
      <RenderMarkdown
        content={'<details><summary>Details</summary>Text</details>'}
      />
    )
    expect(container.querySelector('details')).toBeNull()
    rerender(
      <RenderMarkdown
        enableRawHtml
        content={'<details><summary>Details</summary>Text</details>'}
      />
    )
    expect(container.querySelector('details')).not.toBeNull()
  })
  it('preserves line breaks in model responses (when isUser == undefined)', () => {
    const modelResponseWithNewLines = `This is line 1
    This is line 2
    This is line 3`
    render(<RenderMarkdown content={modelResponseWithNewLines} />)
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer?.innerHTML).toContain('<br>')
    // Match either <br> or <br/>
    const brCount = (markdownContainer?.innerHTML.match(/<br\s*\/?>/g) || [])
      .length
    expect(brCount).toBe(2)
  })

  it('preserves line breaks in user message (when isUser == true)', () => {
    const userMessageWithNewlines = `User question line 1
    User question line 2
    User question line 3`
    render(<RenderMarkdown content={userMessageWithNewlines} isUser={true} />)
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer).toBeTruthy()
    expect(markdownContainer?.innerHTML).toContain('<br>')
    const brCount = (markdownContainer?.innerHTML.match(/<br\s*\/?>/g) || [])
      .length
    expect(brCount).toBe(2)
  })

  it('preserves line breaks with different line ending types', () => {
    const contentWithDifferentLineEndings = 'Line1\nLine2\r\nLine3\rLine4'
    render(<RenderMarkdown content={contentWithDifferentLineEndings} />)
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer?.innerHTML).toContain('<br>')
    const brCount = (markdownContainer?.innerHTML.match(/<br\s*\/?>/g) || [])
      .length
    expect(brCount).toBe(3)
  })

  it('handles empty lines correctly', () => {
    const contentWithEmptyLines =
      'Line 1\n\nLine 3 (after empty line)\n\nLine 5 (after two empty lines)'
    render(<RenderMarkdown content={contentWithEmptyLines} />)
    const markdownContainer = document.querySelector('.markdown')
    const html = markdownContainer?.innerHTML || ''
    // Double new lines (`\n\n`) creates paragraph breaks, not line breaks
    expect(html).not.toContain('<br>')
    const paragraphCount = (html.match(/<p>/g) || []).length
    expect(paragraphCount).toBe(3) // Expect 3 paragraphs for 2 empty lines
  })

  describe('LaTeX normalization - dollar sign escaping', () => {
    it('escapes dollar signs followed by numbers to prevent LaTeX interpretation', () => {
      const content = 'The price is $200 for the item'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$200')
    })

    it('handles multiple dollar amounts in the same content', () => {
      const content = 'Items cost $100, $200, and $350 respectively'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$100')
      expect(text).toContain('$200')
      expect(text).toContain('$350')
    })

    it('handles single digit dollar amounts', () => {
      const content = 'Only $5 or $9 available'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$5')
      expect(text).toContain('$9')
    })

    it('handles large dollar amounts', () => {
      const content = 'The total is $1000000 for the project'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$1000000')
    })

    it('preserves dollar amounts in sentences with mixed content', () => {
      const content = 'I paid $50 yesterday and will pay $75 tomorrow.'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$50')
      expect(text).toContain('$75')
    })

    it('does not interfere with actual LaTeX inline math', () => {
      const content = 'The equation $x + y = z$ is simple'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // LaTeX should be rendered (KaTeX will process it)
      expect(markdownContainer).toBeTruthy()
    })

    it('does not interfere with display math blocks', () => {
      const content = '$$\nx^2 + y^2 = r^2\n$$'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // Display math should be rendered
      expect(markdownContainer).toBeTruthy()
    })
  })

  describe('LaTeX normalization - display math', () => {
    it('converts \\[...\\] to $$ display math', () => {
      const content = 'Here is math:\n\\[\nx^2 + y^2\n\\]\nDone'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // Display math should be rendered by KaTeX
      expect(markdownContainer).toBeTruthy()
    })
  })

  describe('LaTeX normalization - inline math', () => {
    it('converts \\(...\\) to $ inline math', () => {
      const content = 'The formula \\(E = mc^2\\) is famous'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // Inline math should be rendered
      expect(markdownContainer).toBeTruthy()
    })
  })

  describe('LaTeX normalization - code block preservation', () => {
    it('does not process dollar amounts inside code blocks', () => {
      const content = '```\nconst price = $100\n```'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // Code blocks should preserve original content
      expect(markdownContainer).toBeTruthy()
    })

    it('does not process dollar amounts inside inline code', () => {
      const content = 'Use `$100` in the variable'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$100')
    })
  })
})

describe('code rendering latency', () => {
  it('shows and copies all streaming code before enabling syntax highlighting', async () => {
    const code = 'print("first")\nprint("second")'
    const { container, rerender } = render(
      <RenderMarkdown content={'```python\n' + code + '\n```'} isStreaming />
    )
    expect(container.querySelector('code')?.textContent).toBe(code)
    expect(screen.queryByTestId('highlighted-code')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code)
    rerender(<RenderMarkdown content={'```python\n' + code + '\n```'} />)
    await waitFor(() =>
      expect(screen.getByTestId('highlighted-code').textContent).toBe(code)
    )
  })

  it('keeps large finished blocks readable until highlighting is requested', async () => {
    const code = 'print("large code block")\n'.repeat(200).trimEnd()
    const { container } = render(
      <RenderMarkdown content={'```python\n' + code + '\n```'} />
    )
    expect(container.querySelector('code')?.textContent).toBe(code)
    expect(screen.queryByTestId('highlighted-code')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Highlight code' }))
    await waitFor(() =>
      expect(screen.getByTestId('highlighted-code').textContent).toBe(code)
    )
  })
})
