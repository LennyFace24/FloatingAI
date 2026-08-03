import { memo, useMemo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { CodeBlock } from './CodeBlock';

interface RichMessageProps {
  content: string;
}

/** markdown 解析缓存：内容不变时复用渲染结果（组件卸载重挂载也不重解析）。
 * 上限 200 条，避免长会话内存膨胀。 */
const parseCache = new Map<string, React.ReactNode>();
const PARSE_CACHE_LIMIT = 200;

export const RichMessage = memo(function RichMessage({ content }: RichMessageProps) {
  const body = useMemo(() => {
    const cached = parseCache.get(content);
    if (cached !== undefined) return cached;
    const node = (
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
    );
    if (parseCache.size >= PARSE_CACHE_LIMIT) {
      const first = parseCache.keys().next().value;
      if (first !== undefined) parseCache.delete(first);
    }
    parseCache.set(content, node);
    return node;
  }, [content]);

  return <div className="rich-message">{body}</div>;
});
