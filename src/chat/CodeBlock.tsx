import { useEffect, useRef, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import { IconButton } from '../ui/IconButton';
import { Check, Copy } from '../ui/icons';

SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('html', markup);
SyntaxHighlighter.registerLanguage('xml', markup);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);

const LANGUAGE_NAMES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  md: 'markdown',
  py: 'python',
  sh: 'bash',
};

const GRAPHITE_STYLE: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': { color: '#d4d4d4', background: 'transparent' },
  'pre[class*="language-"]': { color: '#d4d4d4', background: 'transparent' },
  comment: { color: '#737373' },
  punctuation: { color: '#a3a3a3' },
  property: { color: '#f5f5f5' },
  tag: { color: '#d4d4d4' },
  boolean: { color: '#f5f5f5' },
  number: { color: '#d4d4d4' },
  constant: { color: '#f5f5f5' },
  symbol: { color: '#d4d4d4' },
  selector: { color: '#e5e5e5' },
  'attr-name': { color: '#d4d4d4' },
  string: { color: '#a3a3a3' },
  char: { color: '#a3a3a3' },
  builtin: { color: '#f5f5f5' },
  operator: { color: '#e5e5e5' },
  entity: { color: '#d4d4d4' },
  url: { color: '#a3a3a3' },
  variable: { color: '#d4d4d4' },
  atrule: { color: '#f5f5f5' },
  'attr-value': { color: '#a3a3a3' },
  function: { color: '#fafafa' },
  'class-name': { color: '#e5e5e5' },
  keyword: { color: '#fafafa', fontWeight: 600 },
  regex: { color: '#a3a3a3' },
  important: { color: '#fafafa', fontWeight: 600 },
};

interface CodeBlockProps {
  language?: string;
  code: string;
}

/** 高亮结果缓存（模块级，跨挂载复用）：react-syntax-highlighter 每次挂载都重新
 * 分词高亮（长代码块可达数十 ms），缓存后切回聊天零重高亮。上限 100 条。 */
const highlightCache = new Map<string, React.ReactElement>();
const HIGHLIGHT_CACHE_LIMIT = 100;

export function CodeBlock({ language = 'text', code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const normalizedLanguage = LANGUAGE_NAMES[language] ?? language;

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const key = `${normalizedLanguage}\u0000${code}`;
  let highlighted = highlightCache.get(key);
  if (!highlighted) {
    highlighted = (
      <SyntaxHighlighter
        language={normalizedLanguage}
        style={GRAPHITE_STYLE}
        customStyle={{ margin: 0, padding: '12px', background: 'transparent', fontSize: '12px' }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)', lineHeight: 1.65 } }}
      >
        {code}
      </SyntaxHighlighter>
    );
    if (highlightCache.size >= HIGHLIGHT_CACHE_LIMIT) {
      const first = highlightCache.keys().next().value;
      if (first !== undefined) highlightCache.delete(first);
    }
    highlightCache.set(key, highlighted);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{normalizedLanguage}</span>
        <IconButton
          className="code-copy-button"
          label={copied ? '已复制代码' : '复制代码'}
          tooltip={copied ? '已复制' : '复制代码'}
          onClick={() => void copyCode()}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </div>
      {highlighted}
    </div>
  );
}
