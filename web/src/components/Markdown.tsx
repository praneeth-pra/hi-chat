import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

import { copyText } from '../clipboard';

const textOf = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return '';
};

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const language =
    /language-([\w-]+)/.exec(
      (children as { props?: { className?: string } } | undefined)?.props?.className ?? ''
    )?.[1] ?? '';
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language}</span>
        <button
          type="button"
          onClick={async () => {
            await copyText(textOf(children));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: CodeBlock,
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
