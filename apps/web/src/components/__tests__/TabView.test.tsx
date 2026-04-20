import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TabView } from '../TabView';

describe('TabView', () => {
  it('switches from preview to edit tab', () => {
    render(<TabView preview={<p>Preview Body</p>} edit={<p>Edit Body</p>} />);

    expect(screen.getByText('Preview Body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Edit Body')).toBeInTheDocument();
  });
});
