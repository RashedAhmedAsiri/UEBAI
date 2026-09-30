"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/** Markdown + GFM tables + LaTeX math (KaTeX). Links open in a new tab. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{ a: ({ href, children: c }) => <a href={href} target="_blank" rel="noreferrer noopener">{c}</a> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
