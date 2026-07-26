import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { CodeBlock } from './CodeBlock';

interface RichMessageProps {
  content: string;
}


export function RichMessage({ content }: RichMessageProps) {
  return (
    <div className="rich-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) {
            const language = className?.match(/language-([\w-]+)/)?.[1];
            const value = String(children).replace(/\n$/, '');
            if (language) return <CodeBlock language={language} code={value} />;
            return <code className="inline-code" {...props}>{children}</code>;
          },
          a({ children, ...props }) {
            return <a {...props} target="_blank" rel="noreferrer">{children}</a>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
