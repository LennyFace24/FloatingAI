import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

describe('CodeBlock', () => {
  it('copies code and shows success state', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<CodeBlock language="typescript" code="const value = 1;" />);
    await user.click(screen.getByRole('button', { name: '复制代码' }));

    expect(writeText).toHaveBeenCalledWith('const value = 1;');
    expect(screen.getByRole('button', { name: '已复制代码' })).toBeInTheDocument();
  });
});
