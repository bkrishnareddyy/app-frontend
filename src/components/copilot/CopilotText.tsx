"use client";

import type { ReactNode } from "react";

/**
 * Renders the Copilot's answer text.
 *
 * The repository has no markdown library, and this is not the place to add one.
 * Model output is untrusted text that may quote a supplier's document verbatim,
 * so it is parsed into React nodes here — never assigned as HTML. There is no
 * `dangerouslySetInnerHTML` anywhere in the Copilot, which means a document
 * field containing a `<script>` tag or an `<img onerror=...>` renders as the
 * characters it is.
 *
 * The subset supported is the subset the prompt asks for: paragraphs, bullet and
 * numbered lists, inline bold and inline code. Anything else, including a link,
 * shows as literal text. Links in particular are omitted on purpose — the model
 * does not get to put a URL in front of the user; navigation goes through
 * validated actions with server-built routes.
 */

const BOLD_OR_CODE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(BOLD_OR_CODE)
    .filter((part) => part !== "")
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return (
          <strong key={key} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return (
          <code
            key={key}
            className="px-1 py-0.5 rounded bg-surface-muted border border-border text-[11px] font-mono text-ink"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={key}>{part}</span>;
    });
}

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] };

function parse(text: string): Block[] {
  const blocks: Block[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.trim() === "") {
      // A blank line ends whatever block was open.
      if (blocks.length > 0) blocks.push({ kind: "paragraph", lines: [] });
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];

    if (bullet) {
      if (last?.kind === "bullets") last.items.push(bullet[1]);
      else blocks.push({ kind: "bullets", items: [bullet[1]] });
      continue;
    }

    if (numbered) {
      if (last?.kind === "numbers") last.items.push(numbered[1]);
      else blocks.push({ kind: "numbers", items: [numbered[1]] });
      continue;
    }

    // Leading hashes are stripped rather than rendered as a heading: a heading
    // inside a panel this narrow reads as shouting.
    const content = line.replace(/^#{1,6}\s+/, "");

    if (last?.kind === "paragraph" && last.lines.length > 0) last.lines.push(content);
    else blocks.push({ kind: "paragraph", lines: [content] });
  }

  return blocks.filter((block) => block.kind !== "paragraph" || block.lines.length > 0);
}

export function CopilotText({ text }: { text: string }) {
  const blocks = parse(text);

  return (
    <div className="space-y-2 text-xs leading-relaxed text-ink">
      {blocks.map((block, blockIndex) => {
        if (block.kind === "bullets") {
          return (
            <ul key={blockIndex} className="space-y-1 pl-4 list-disc marker:text-ink-muted">
              {block.items.map((item, index) => (
                <li key={index}>{inline(item, `${blockIndex}-${index}`)}</li>
              ))}
            </ul>
          );
        }

        if (block.kind === "numbers") {
          return (
            <ol key={blockIndex} className="space-y-1 pl-4 list-decimal marker:text-ink-muted">
              {block.items.map((item, index) => (
                <li key={index}>{inline(item, `${blockIndex}-${index}`)}</li>
              ))}
            </ol>
          );
        }

        return <p key={blockIndex}>{inline(block.lines.join(" "), `${blockIndex}`)}</p>;
      })}
    </div>
  );
}
