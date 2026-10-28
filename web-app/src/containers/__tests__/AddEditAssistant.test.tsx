import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import AddEditAssistant from '../dialogs/AddEditAssistant'

const setupAssistant = vi.fn()
vi.mock('@/lib/assistantSetup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/assistantSetup')>()),
  setupAssistant: (...args: unknown[]) => setupAssistant(...args),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({ getProviderByName: () => undefined }),
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

const saved = {
  id: 'a1',
  avatar: '🧑‍💼',
  created_at: 1,
  name: 'Acme · Data Analyst',
  instructions: 'old',
  documents: [{ name: 'resume.pdf', text: 'resume' }],
  parameters: {},
} as unknown as Assistant

describe('AddEditAssistant name', () => {
  it('renames a saved assistant without setting it up again', () => {
    const onSave = vi.fn()
    render(
      <AddEditAssistant
        open
        onOpenChange={vi.fn()}
        editingKey="a1"
        initialData={saved}
        onSave={onSave}
      />
    )
    const input = screen.getByLabelText('Assistant name')
    expect(input).toHaveValue('Acme · Data Analyst')
    fireEvent.change(input, { target: { value: '  Acme QA  ' } })
    fireEvent.click(screen.getByText('assistants:save'))
    expect(setupAssistant).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledWith({ ...saved, name: 'Acme QA' })
  })

  it('starts empty for a new assistant so the name is made for you', () => {
    render(
      <AddEditAssistant
        open
        onOpenChange={vi.fn()}
        editingKey={null}
        onSave={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Assistant name')).toHaveValue('')
  })
})

describe('AddEditAssistant resume is optional', () => {
  it('creates an assistant from other context alone', async () => {
    setupAssistant.mockReset()
    setupAssistant.mockResolvedValue({ ...saved, name: 'Made' })
    const onSave = vi.fn()
    render(
      <AddEditAssistant
        open
        onOpenChange={vi.fn()}
        editingKey={null}
        onSave={onSave}
      />
    )
    const create = screen.getByText('Create assistant')
    expect(create).toBeDisabled()
    expect(screen.getByLabelText('Upload Resume')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Other context'), {
      target: { value: 'Backend engineer, 5 years of Go' },
    })
    expect(create).not.toBeDisabled()
    fireEvent.click(create)
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(setupAssistant.mock.calls[0][0]).toBeUndefined()
    expect(setupAssistant.mock.calls[0][5]).toBe(
      'Backend engineer, 5 years of Go'
    )
  })

  it('lets a saved resume be removed', async () => {
    setupAssistant.mockReset()
    setupAssistant.mockResolvedValue(saved)
    const withJd = {
      ...saved,
      documents: [
        { name: 'resume.pdf', text: 'resume', kind: 'resume' },
        { name: 'jd.pdf', text: 'jd', kind: 'job' },
      ],
    } as unknown as Assistant
    render(
      <AddEditAssistant
        open
        onOpenChange={vi.fn()}
        editingKey="a1"
        initialData={withJd}
        onSave={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('Remove Resume'))
    expect(screen.getAllByText('Not uploaded')).toHaveLength(1)
    fireEvent.click(screen.getByText('assistants:save'))
    await waitFor(() => expect(setupAssistant).toHaveBeenCalled())
    expect(setupAssistant.mock.calls[0][0]).toBeUndefined()
    expect(setupAssistant.mock.calls[0][1]).toEqual({
      name: 'jd.pdf',
      text: 'jd',
    })
  })
})
