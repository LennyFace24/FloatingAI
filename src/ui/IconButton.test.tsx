import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('exposes accessible label, tooltip and click behavior', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton label="打开设置" tooltip="设置" onClick={onClick}>
        <span>icon</span>
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: '打开设置' });
    expect(button).toHaveAttribute('title', '设置');
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses native disabled behavior', () => {
    render(
      <IconButton label="停止" tooltip="停止生成" disabled>
        <span>icon</span>
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled();
  });
});
