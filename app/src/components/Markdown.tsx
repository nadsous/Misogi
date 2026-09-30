import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown des agents (demande, réponse finale) rendu proprement : gras, listes, code, tableaux.
 * Pas de HTML brut ni d'images, et les liens ne naviguent pas : la fenêtre reste sur Misogi.
 */
const components: Components = {
  h1: ({ children }) => <p className="font-semibold">{children}</p>,
  h2: ({ children }) => <p className="font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
  h4: ({ children }) => <p className="font-semibold">{children}</p>,
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  a: ({ children, href }) => (
    <span className="underline decoration-dotted" title={href}>
      {children}
    </span>
  ),
  img: ({ alt }) => <span>{alt}</span>,
  code: ({ children, className }) =>
    className ? <code className="font-mono text-2xs">{children}</code> : <code className="rounded bg-raised px-1 font-mono text-[0.92em]">{children}</code>,
  pre: ({ children }) => <pre className="my-1 overflow-x-auto rounded-md bg-raised p-2">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="my-1 border-l-2 border-line pl-2 text-muted">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="text-2xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-line px-1.5 py-0.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-line px-1.5 py-0.5">{children}</td>,
  hr: () => <hr className="my-2 border-line" />,
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
