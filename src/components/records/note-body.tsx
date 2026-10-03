import type { ReactNode } from "react";

const TOKEN = /(@\[([^\]]{1,80})\]\(user:[A-Za-z0-9_-]{1,40}\))|(\*\*[^*\n]{1,200}\*\*)|(https?:\/\/[^\s<]{1,300})/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    if (m[1]) out.push(<span key={`${keyBase}-${i}`} className="rounded bg-primary-soft px-1 font-medium text-primary">@{m[2]}</span>);
    else if (m[4]) out.push(<strong key={`${keyBase}-${i}`}>{m[0].slice(2, -2)}</strong>);
    else if (m[5]) out.push(<a key={`${keyBase}-${i}`} href={m[5]} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">{m[5]}</a>);
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders the lightweight note markup (bold, links, bullets, @mentions) as React nodes — never raw HTML. */
export function NoteBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      blocks.push(<ul key={`ul-${k}`} className="ml-4 list-disc space-y-0.5">{list.map((l, i) => <li key={i}>{inline(l, `li-${k}-${i}`)}</li>)}</ul>);
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) list.push(bullet[1]!);
    else {
      flush(i);
      blocks.push(line.trim() ? <p key={i}>{inline(line, `p-${i}`)}</p> : <div key={i} className="h-1.5" />);
    }
  });
  flush(lines.length);
  return <div className="space-y-1 break-words text-[13px] leading-relaxed text-fg">{blocks}</div>;
}
