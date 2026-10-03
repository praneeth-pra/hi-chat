import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pickerModels } from '../api';
import { ModelsPage } from './ModelsPage';

const models = ['a-model', 'b-model', 'c-model'];

afterEach(cleanup);

describe('pickerModels', () => {
  it('offers every model when none are enabled', () => {
    expect(pickerModels(models, [])).toEqual(models);
  });

  it('offers only enabled models that still exist', () => {
    expect(pickerModels(models, ['c-model', 'gone'])).toEqual(['c-model']);
    expect(pickerModels(models, ['gone'])).toEqual(models);
  });
});

describe('ModelsPage', () => {
  const setup = (enabled: string[] = [], defaultModel = 'a-model') => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ModelsPage
        models={models}
        enabled={enabled}
        defaultModel={defaultModel}
        error={null}
        onSave={onSave}
        onClose={() => {}}
      />
    );
    return onSave;
  };

  it('starts with every model shown and saves the ones left ticked', async () => {
    const onSave = setup();
    expect(screen.getByText('All 3 models shown')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'b-model' }));
    expect(screen.getByText('2 of 3 shown')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].sort()).toEqual(['a-model', 'c-model']);
    expect(onSave.mock.calls[0][1]).toBe('a-model');
  });

  it('moves the default to a shown model when the starred one is hidden', async () => {
    const onSave = setup(['a-model', 'b-model']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'a-model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(['b-model'], 'b-model'));
  });

  it('stars a new default', async () => {
    const onSave = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Make c-model the default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith([], 'c-model'));
  });
});
