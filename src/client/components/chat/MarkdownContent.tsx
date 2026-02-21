import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-bold text-foreground mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold text-foreground mb-2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-foreground mb-1">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-foreground/80 mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-primary underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc ml-4 text-foreground/80 mb-2">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal ml-4 text-foreground/80 mb-2">{children}</ol>
  ),
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block bg-muted rounded-lg overflow-x-auto p-3 text-xs text-foreground/90">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-muted rounded px-1 py-0.5 text-xs text-foreground/90">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
  table: ({ children }) => (
    <table className="border-collapse border border-border mb-2 text-sm w-full">
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th className="border border-border px-3 py-1 text-left text-foreground bg-muted break-all">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-1 text-foreground/80 break-all">
      {children}
    </td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground italic mb-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
};

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
