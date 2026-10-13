// Rich text for news. The editor (TipTap) produces a ProseMirror JSON document;
// the server validates it against this closed schema and renders the HTML
// itself, escaping every text node. HTML sent by a client is never stored.
import { z } from "zod";
import { SAFE_URL } from "./schemas";

export const LINK_URL = /^(https?:\/\/[^\s"'<>`\\]+|mailto:[^\s"'<>`\\]+|\/(?!\/)[^\s"'<>`\\]*)$/i;

const mark = z.union([
  z.strictObject({ type: z.literal("bold") }),
  z.strictObject({ type: z.literal("italic") }),
  z.strictObject({
    type: z.literal("link"),
    attrs: z.looseObject({ href: z.string().regex(LINK_URL, { error: "Link non valido" }) }),
  }),
]);

const textNode = z.strictObject({
  type: z.literal("text"),
  text: z.string().max(20000),
  marks: z.array(mark).max(5).optional(),
});

export type RichNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: RichNode[];
};

const inline = z.union([textNode, z.strictObject({ type: z.literal("hardBreak") })]);
const paragraph = z.strictObject({ type: z.literal("paragraph"), attrs: z.looseObject({}).optional(), content: z.array(inline).optional() });
const heading = z.strictObject({
  type: z.literal("heading"),
  attrs: z.looseObject({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: z.array(inline).optional(),
});
const image = z.strictObject({
  type: z.literal("image"),
  attrs: z.looseObject({
    src: z.string().regex(SAFE_URL, { error: "Immagine non valida" }),
    alt: z.string().max(300).nullable().optional(),
    title: z.string().max(300).nullable().optional(),
  }),
});
const rule = z.strictObject({ type: z.literal("horizontalRule") });

const block: z.ZodType<RichNode> = z.lazy(() =>
  z.union([
    paragraph,
    heading,
    image,
    rule,
    z.strictObject({ type: z.literal("blockquote"), content: z.array(block).max(200) }),
    z.strictObject({ type: z.literal("bulletList"), content: z.array(listItem).max(200) }),
    z.strictObject({ type: z.literal("orderedList"), attrs: z.looseObject({}).optional(), content: z.array(listItem).max(200) }),
  ]),
) as z.ZodType<RichNode>;
const listItem = z.strictObject({ type: z.literal("listItem"), content: z.array(block).max(50) });

export const richDocSchema = z.strictObject({ type: z.literal("doc"), content: z.array(block).max(1000) });
export type RichDoc = { type: "doc"; content: RichNode[] };

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderInline(nodes: RichNode[] | undefined): string {
  return (nodes || [])
    .map((node) => {
      if (node.type === "hardBreak") return "<br>";
      let html = esc(node.text);
      for (const m of node.marks || []) {
        if (m.type === "bold") html = `<strong>${html}</strong>`;
        else if (m.type === "italic") html = `<em>${html}</em>`;
        else if (m.type === "link") {
          const href = String(m.attrs?.href || "");
          const external = /^https?:/i.test(href);
          html = `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${html}</a>`;
        }
      }
      return html;
    })
    .join("");
}

function renderBlock(node: RichNode): string {
  switch (node.type) {
    case "paragraph": {
      const inner = renderInline(node.content);
      return inner ? `<p>${inner}</p>` : "";
    }
    case "heading": {
      const level = node.attrs?.level === 3 ? 3 : 2;
      return `<h${level}>${renderInline(node.content)}</h${level}>`;
    }
    case "image": {
      const alt = String(node.attrs?.alt || "");
      const caption = String(node.attrs?.title || "");
      return `<figure class="article-inline-image"><img loading="lazy" decoding="async" src="${esc(node.attrs?.src)}" alt="${esc(alt || caption || "Immagine articolo")}">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;
    }
    case "horizontalRule":
      return "<hr>";
    case "blockquote":
      return `<blockquote>${(node.content || []).map(renderBlock).join("")}</blockquote>`;
    case "bulletList":
      return `<ul>${(node.content || []).map(renderBlock).join("")}</ul>`;
    case "orderedList":
      return `<ol>${(node.content || []).map(renderBlock).join("")}</ol>`;
    case "listItem":
      return `<li>${(node.content || []).map(renderBlock).join("")}</li>`;
    default:
      return "";
  }
}

export function renderRichHtml(doc: RichDoc): string {
  return doc.content.map(renderBlock).join("");
}

function inlineText(nodes: RichNode[] | undefined): string {
  return (nodes || []).map((n) => (n.type === "hardBreak" ? "\n" : n.text || "")).join("").trim();
}

/** Plain paragraphs, stored in `body` for excerpts, search and the SEO generator fallback. */
export function richParagraphs(doc: RichDoc): string[] {
  const out: string[] = [];
  const walk = (node: RichNode) => {
    if (node.type === "paragraph" || node.type === "heading") {
      const t = inlineText(node.content);
      if (t) out.push(t);
    } else if (node.content && node.type !== "text") node.content.forEach(walk);
  };
  doc.content.forEach(walk);
  return out;
}

export function richImages(doc: RichDoc): string[] {
  const out: string[] = [];
  const walk = (node: RichNode) => {
    if (node.type === "image" && typeof node.attrs?.src === "string") out.push(node.attrs.src);
    node.content?.forEach(walk);
  };
  doc.content.forEach(walk);
  return out;
}

/** Converts the legacy Decap fields (body paragraphs or contentBlocks) into an editor document. */
export function legacyNewsToDoc(item: { body?: unknown; contentBlocks?: unknown; excerpt?: unknown }): RichDoc {
  const content: RichNode[] = [];
  const para = (t: string): RichNode => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
  if (Array.isArray(item.contentBlocks) && item.contentBlocks.length) {
    for (const raw of item.contentBlocks as Array<Record<string, unknown>>) {
      if (!raw) continue;
      const img = typeof raw.image === "string" ? raw.image.trim() : "";
      if ((raw.type === "image" || img) && img && SAFE_URL.test(img)) {
        content.push({ type: "image", attrs: { src: img, alt: String(raw.caption || ""), title: String(raw.caption || "") } });
      } else if (typeof raw.text === "string" && raw.text.trim()) content.push(para(raw.text.trim()));
    }
  } else if (Array.isArray(item.body)) {
    for (const p of item.body) if (typeof p === "string" && p.trim()) content.push(para(p.trim()));
  } else if (typeof item.body === "string" && item.body.trim()) {
    for (const p of item.body.split(/\n+/)) if (p.trim()) content.push(para(p.trim()));
  }
  if (!content.length) content.push(para(""));
  return { type: "doc", content };
}
