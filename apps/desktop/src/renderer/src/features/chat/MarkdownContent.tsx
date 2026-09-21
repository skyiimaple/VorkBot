import { Check, Copy } from "lucide-react";
import { Children, isValidElement, useCallback, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return collectText(node.props.children);
  return "";
}

function languageFromClassName(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const match = /language-([a-z0-9_+-]+)/i.exec(className);
  return match?.[1];
}

function CodeFence({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeElement = Children.toArray(children).find((child) => isValidElement(child));
  const className =
    isValidElement<{ className?: string }>(codeElement) ? codeElement.props.className : undefined;
  const language = languageFromClassName(className);
  const codeText = collectText(children).replace(/\n$/, "");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(codeText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默失败
    }
  }, [codeText]);

  return (
    <div className="markdown-code-block group relative my-2.5 overflow-hidden rounded-xl border border-border/70 bg-[#1e1e1e] text-[12.5px] leading-relaxed text-[#d4d4d4] shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/25 px-3 py-1.5">
        <span className="truncate font-mono text-[10px] uppercase tracking-wide text-white/55">
          {language ?? "code"}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 gap-1 rounded-md px-1.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "已复制" : "复制代码"}
        </Button>
      </div>
      <pre className="m-0 overflow-x-auto p-3 scrollbar-grok">{children}</pre>
    </div>
  );
}

export function MarkdownContent({
  content,
  className,
  showCursor
}: {
  content: string;
  className?: string;
  showCursor?: boolean;
}) {
  return (
    <div
      className={cn("markdown-body text-[14px] leading-relaxed text-foreground", className)}
      data-markdown-body="true"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-[1.25rem] font-semibold tracking-tight first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-[1.1rem] font-semibold tracking-tight first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-[1rem] font-semibold first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a href={href} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-border bg-muted/60 px-2 py-1 font-medium">{children}</th>,
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
          pre: ({ children }) => <CodeFence>{children}</CodeFence>,
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className?.includes("language-") || className?.includes("hljs"));
            if (isBlock) {
              return (
                <code className={cn("font-mono text-[12.5px]", className)} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
                {...props}
              >
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
      {showCursor ? <span className="markdown-cursor" aria-hidden /> : null}
    </div>
  );
}
