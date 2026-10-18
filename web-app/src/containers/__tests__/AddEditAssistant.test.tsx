import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import AddEditAssistant from '../dialogs/AddEditAssistant'

const setupAssistant = vi.fn()
vi.mock('@/lib/assistantSetup', () => ({
  OTHER_CONTEXT_NAME: 'Other context',
  setupAssistant: (...args: unknown[]) => setupAssistant(...args),
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
