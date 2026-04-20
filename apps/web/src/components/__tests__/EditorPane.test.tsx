import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorPane } from '../EditorPane';

describe('EditorPane', () => {
  it('calls save callback with current content and updates state', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditorPane initialValue="# hello" onSave={onSave} />);

    const textarea = screen.getByLabelText('Markdown editor');
    fireEvent.change(textarea, { target: { value: '# updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('# updated');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
