import { type ReactNode, isValidElement, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Themed markdown renderer for the Docs view. Styling is done through component
 * overrides (not a global stylesheet) so everything resolves the same CSS
 * variables the rest of the dashboard uses — light/dark themes "just work".
 *
 * Two Unwind-specific touches:
 *  - the `[MUST]` / `[SHOULD]` / `[DON'T]` rebuild tags that the analysis writes
 *    into headings are pulled out and rendered as colored chips;
 *  - the `<!-- id: ... -->` anchor comments are dropped automatically (we don't
 *    enable raw HTML), so they never leak into the rendered output.
 */

const PRIO_TAGS: Record<string, { label: string; varName: string }> = {
  MUST: { label: "MUST", varName: "--color-prio-must" },
  SHOULD: { label: "SHOULD", varName: "--color-prio-should" },
  "DON'T": { label: "DON'T", varName: "--color-prio-dont" },
};

/** Pull a trailing `[MUST]`/`[SHOULD]`/`[DON'T]` tag off heading children. */
function splitTag(children: ReactNode): { rest: ReactNode; tag: string | null } {
  const arr = Array.isArray(children) ? [...children] : [children];
  for (let i = arr.length - 1; i >= 0; i--) {
    const c = arr[i];
    if (typeof c !== "string") {
      if (c == null || c === false) continue; // skip empty trailing nodes
      break; // last meaningful child isn't text → no tag
    }
    const m = c.match(/^(.*?)\s*\[(MUST|SHOULD|DON'T)\]\s*$/s);
    if (!m) break;
    const stripped = m[1];
    if (stripped) arr[i] = stripped;
    else arr.splice(i, 1);
    return { rest: arr, tag: m[2] };
  }
  return { rest: children, tag: null };
}

function TagChip({ tag }: { tag: string }) {
  const meta = PRIO_TAGS[tag];
  if (!meta) return null;
  return (
    <span
      className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide"
      style={{
        color: `var(${meta.varName})`,
        backgroundColor: `color-mix(in srgb, var(${meta.varName}) 16%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  );
}

function heading(Tag: "h1" | "h2" | "h3" | "h4", className: string) {
  return function Heading({ children }: { children?: ReactNode }) {
    const { rest, tag } = splitTag(children);
    return (
      <Tag className={className}>
        {rest}
        {tag && <TagChip tag={tag} />}
      </Tag>
    );
  };
}

/** Resolve a relative doc link (e.g. "../api/endpoints.md") against the open doc. */
function resolveDocPath(from: string, href: string): string {
  const base = from.split("/").slice(0, -1);
  for (const seg of href.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") base.pop();
    else base.push(seg);
  }
  return base.join("/");
}

export default function MarkdownView({
  content,
  docPath,
  onNavigate,
}: {
  content: string;
  docPath: string;
  /** Called when an in-bundle relative `.md` link is clicked. */
  onNavigate?: (path: string) => void;
}) {
  // Strip HTML comments (the `<!-- id: ... -->` anchors the analysis writes into
  // headings). react-markdown surfaces them as literal text without rehype-raw,
  // and they'd otherwise sit between the heading name and its [MUST] tag — which
  // also breaks tag-chip extraction. Removing them leaves a clean `name [MUST]`.
  const cleaned = useMemo(() => content.replace(/<!--[\s\S]*?-->/g, ""), [content]);

  const components: Components = {
    h1: heading("h1", "text-2xl font-semibold text-text-primary mt-8 mb-3 first:mt-0"),
    h2: heading(
      "h2",
      "text-xl font-semibold text-text-primary mt-7 mb-3 pb-1 border-b border-border-subtle",
    ),
    h3: heading("h3", "text-base font-semibold text-text-primary mt-5 mb-2"),
    h4: heading("h4", "text-sm font-semibold text-text-secondary mt-4 mb-2"),
    p: ({ children }) => <p className="text-sm text-text-secondary leading-relaxed my-3">{children}</p>,
    ul: ({ children }) => <ul className="list-disc pl-6 my-3 space-y-1 text-sm text-text-secondary">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-6 my-3 space-y-1 text-sm text-text-secondary">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    a: ({ href, children }) => {
      const isRelMd = !!href && !/^[a-z]+:/i.test(href) && !href.startsWith("#") && /\.md(#.*)?$/.test(href);
      if (isRelMd && onNavigate) {
        const target = resolveDocPath(docPath, href.replace(/#.*$/, ""));
        return (
          <button
            type="button"
            onClick={() => onNavigate(target)}
            className="text-accent hover:underline underline-offset-2"
          >
            {children}
          </button>
        );
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline underline-offset-2 break-words"
        >
          {children}
        </a>
      );
    },
    code: ({ className, children }) => {
      // Inline code only — fenced blocks arrive wrapped in <pre> (handled below).
      const isBlock = /language-/.test(className ?? "");
      if (isBlock) return <code className={className}>{children}</code>;
      return (
        <code className="font-mono text-[0.85em] px-1 py-0.5 rounded bg-root text-accent-bright">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-4 overflow-auto rounded-lg bg-root border border-border-subtle p-3 text-xs font-mono leading-relaxed text-text-secondary">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-accent/50 pl-4 text-sm text-text-muted italic">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="my-4 overflow-auto">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="text-left">{children}</thead>,
    th: ({ children }) => (
      <th className="border border-border-subtle bg-elevated/60 px-3 py-1.5 font-semibold text-text-primary">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-border-subtle px-3 py-1.5 text-text-secondary align-top">{children}</td>
    ),
    hr: () => <hr className="my-6 border-border-subtle" />,
    img: ({ src, alt }) =>
      typeof src === "string" && isValidElement(src) === false ? (
        <img src={src} alt={alt ?? ""} className="my-3 max-w-full rounded" />
      ) : null,
  };

  return (
    <div className="max-w-3xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
