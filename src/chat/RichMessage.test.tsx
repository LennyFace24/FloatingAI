import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichMessage } from './RichMessage';

const content = [
  '## Binary search',
  '',
  '- O(log n)',
  '- Requires sorted input',
  '',
  'Inline $O(1)$ and block:',
  '',
  '$$',
  'T(n)=T(n/2)+O(1)',
  '$$',
  '',
  '```ts',
  'const mid = (left + right) >> 1;',
  '```',
].join('\n');

describe('RichMessage', () => {
  it('renders markdown, math and fenced code', () => {
    const { container } = render(<RichMessage content={content} />);
    expect(screen.getByRole('heading', { name: 'Binary search' })).toBeInTheDocument();
    expect(screen.getByText('Requires sorted input')).toBeInTheDocument();
    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.querySelector('.katex-display')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制代码' })).toBeInTheDocument();
  });

  it('does not mount raw HTML', () => {
    const { container } = render(<RichMessage content={'<script>alert(1)</script>'} />);
    expect(container.querySelector('script')).not.toBeInTheDocument();
  });
});
