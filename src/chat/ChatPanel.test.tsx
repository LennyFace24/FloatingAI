import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';

describe('ChatPanel', () => {
  it('focuses input and sends user text', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue('req-1');

    render(
      <ChatPanel
        messages={[]}
        status="idle"
        onSend={onSend}
        onStop={() => Promise.resolve()}
        onClear={() => undefined}
        onCollapse={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    const input = screen.getByLabelText('输入问题');
    expect(input).toHaveFocus();

    await user.type(input, '解释这个报错');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSend).toHaveBeenCalledWith('解释这个报错');
  });

  it('shows stop button while streaming', () => {
    render(
      <ChatPanel
        messages={[{ id: 'a1', role: 'assistant', content: 'partial', requestId: 'req-1' }]}
        status="streaming"
        activeRequestId="req-1"
        onSend={() => Promise.resolve('req-2')}
        onStop={() => Promise.resolve()}
        onClear={() => undefined}
        onCollapse={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
  });

  it('collapses on Escape', async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();

    render(
      <ChatPanel
        messages={[]}
        status="idle"
        onSend={() => Promise.resolve('req-1')}
        onStop={() => Promise.resolve()}
        onClear={() => undefined}
        onCollapse={onCollapse}
        onOpenSettings={() => undefined}
      />,
    );

    await user.keyboard('{Escape}');
    expect(onCollapse).toHaveBeenCalled();
  });
});
