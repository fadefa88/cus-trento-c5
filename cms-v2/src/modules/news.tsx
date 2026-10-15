import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Bold, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Loader2, Minus, Newspaper, Quote, Redo2, Undo2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { NEWS_TAGS } from "@shared/documents";
import { legacyNewsToDoc, renderRichHtml, richDocSchema, type RichDoc } from "@shared/richtext";
import { LINK_URL } from "@shared/richtext";
import { SITE } from "@shared/site";
import { CollectionPage, type CollectionConfig, type Item } from "@/components/collection";
import { FormSection } from "@/components/editor";
import { ChipsField, DateField, ImageField, TextAreaField, TextField, ToggleRow, useUpload } from "@/components/fields";
import { Badge, SegmentedControl } from "@/components/ui/primitives";
import { cn, formatDate, todayIso } from "@/lib/utils";

const str = (v: unknown) => String(v ?? "");

function ToolbarButton({ onClick, active, label, children, disabled }: { onClick: () => void; active?: boolean; label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} title={label} className={cn("grid size-10 shrink-0 place-items-center rounded-lg text-foreground/80 disabled:opacity-30", active ? "bg-foreground text-background" : "hover:bg-surface-2")}>
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const { upload, busy } = useUpload();
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    editor.on("transaction", force);
    return () => {
      editor.off("transaction", force);
    };
  }, [editor]);
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Indirizzo del link (https://…, mailto:… o /pagina/)", prev || "https://");
    if (url === null) return;
    if (!url.trim()) return void editor.chain().focus().unsetLink().run();
    if (!LINK_URL.test(url.trim())) return void toast.error("Link non valido: usa https://, mailto: oppure un percorso del sito");
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  return (
    <div className="scrollbar-none sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-surface/95 p-1.5 backdrop-blur">
      <ToolbarButton label="Grassetto" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" /></ToolbarButton>
      <ToolbarButton label="Corsivo" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></ToolbarButton>
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}><Link2 className="size-4" /></ToolbarButton>
      <span className="mx-1 w-px shrink-0 bg-border" />
      <ToolbarButton label="Titolo" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="size-4" /></ToolbarButton>
      <ToolbarButton label="Sottotitolo" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="size-4" /></ToolbarButton>
      <ToolbarButton label="Elenco puntato" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="size-4" /></ToolbarButton>
      <ToolbarButton label="Elenco numerato" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></ToolbarButton>
      <ToolbarButton label="Citazione" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="size-4" /></ToolbarButton>
      <ToolbarButton label="Separatore" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="size-4" /></ToolbarButton>
      <ToolbarButton label="Immagine" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}</ToolbarButton>
      <span className="mx-1 w-px shrink-0 bg-border" />
      <ToolbarButton label="Annulla" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="size-4" /></ToolbarButton>
      <ToolbarButton label="Ripeti" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="size-4" /></ToolbarButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const src = await upload(f, "news");
            const caption = window.prompt("Didascalia (facoltativa)") || "";
            editor.chain().focus().setImage({ src, alt: caption, title: caption }).run();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Caricamento non riuscito");
          }
        }}
      />
    </div>
  );
}

/** Rich text editor limited to what the server accepts (see shared/richtext.ts). */
function RichEditor({ value, onChange }: { value: RichDoc; onChange: (doc: RichDoc) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, strike: false, underline: false, link: false }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ["mailto"], HTMLAttributes: { rel: "noopener noreferrer" } }),
      Image.configure({ inline: false }),
    ],
    content: value,
    editorProps: { attributes: { class: "prose-cms px-4 py-3 text-[17px]", "aria-label": "Testo dell'articolo" } },
    onUpdate: ({ editor }) => onChange(sanitizeDoc(editor.getJSON() as RichDoc)),
  });
  if (!editor) return <div className="h-60 animate-pulse rounded-2xl bg-surface-2" />;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface focus-within:border-primary">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

/** Drops attributes TipTap adds that the server schema does not accept (e.g. link target, empty attrs). */
function sanitizeDoc(doc: RichDoc): RichDoc {
  const clean = (node: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { type: node.type };
    if (node.type === "text") {
      out.text = node.text;
      if (Array.isArray(node.marks) && node.marks.length) {
        out.marks = (node.marks as Array<Record<string, unknown>>).filter((m) => ["bold", "italic", "link"].includes(String(m.type))).map((m) => (m.type === "link" ? { type: "link", attrs: { href: (m.attrs as Record<string, unknown>)?.href } } : { type: m.type }));
        if (!(out.marks as unknown[]).length) delete out.marks;
      }
      return out;
    }
    if (node.type === "heading") out.attrs = { level: (node.attrs as Record<string, unknown>)?.level === 3 ? 3 : 2 };
    if (node.type === "image") {
      const a = (node.attrs || {}) as Record<string, unknown>;
      out.attrs = { src: a.src, alt: a.alt ?? null, title: a.title ?? null };
    }
    if (Array.isArray(node.content)) out.content = (node.content as Array<Record<string, unknown>>).map(clean);
    return out;
  };
  return clean(doc as unknown as Record<string, unknown>) as unknown as RichDoc;
}

function NewsForm({ value: v, set }: { value: Item; set: (k: string, x: unknown) => void }) {
  const [view, setView] = React.useState<"edit" | "preview">("edit");
  const doc = React.useMemo(() => (v.contentDoc && richDocSchema.safeParse(v.contentDoc).success ? (v.contentDoc as RichDoc) : legacyNewsToDoc(v)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const current = (v.contentDoc as RichDoc) || doc;
  const slug = str(v.slug) || SITE.slugify(`${str(v.title)} ${str(v.date)}`);
  return (
    <>
      <SegmentedControl value={view} onChange={setView} options={[{ value: "edit", label: "Scrivi" }, { value: "preview", label: "Anteprima" }]} className="w-full" />
      {view === "preview" ? (
        <article className="overflow-hidden rounded-3xl border border-border bg-surface">
          {!!v.image && <img src={str(v.image)} alt="" className="aspect-[16/9] w-full object-cover" />}
          <div className="p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">{str(v.category) || "News"} · {formatDate(v.date)}</p>
            <h2 className="mt-1 font-display text-3xl font-bold leading-tight">{str(v.title) || "Titolo"}</h2>
            {!!v.excerpt && <p className="mt-2 text-muted">{str(v.excerpt)}</p>}
            <div className="prose-cms mt-4" dangerouslySetInnerHTML={{ __html: renderRichHtml(current) }} />
          </div>
        </article>
      ) : (
        <>
          <TextField label="Titolo" required value={v.title} onChange={(x) => set("title", x)} />
          <TextAreaField label="Sommario" value={v.excerpt} onChange={(x) => set("excerpt", x)} rows={2} hint="Compare nelle anteprime e nei risultati di ricerca (circa 150 caratteri)." />
          <ImageField label="Immagine di copertina" value={v.image} onChange={(x) => set("image", x)} profile="news" crop={false} />
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-foreground/80">Testo</p>
            <RichEditor value={doc} onChange={(d) => set("contentDoc", d)} />
          </div>
          <FormSection title="Pubblicazione">
            <div className="grid grid-cols-2 gap-3">
              <DateField label="Data" required value={v.date} onChange={(x) => set("date", x)} />
              <TextField label="Autore" value={v.author} onChange={(x) => set("author", x)} />
            </div>
            <TextField label="Categoria" value={v.category} onChange={(x) => set("category", x)} placeholder="Prima squadra, Club…" />
            <ChipsField label="Tag" value={v.tags} onChange={(x) => set("tags", x)} options={NEWS_TAGS} />
            <ToggleRow checked={!!v.pinned} onChange={(x) => set("pinned", x)} label="In evidenza" description="Mostra l'articolo in primo piano." />
          </FormSection>
          <FormSection title="SEO e indirizzo" description={`${SITE.config.siteUrl}/news/${slug}/`}>
            <TextField label="Slug" value={v.slug} onChange={(x) => set("slug", SITE.slugify(x))} placeholder={slug} hint={v.id ? "Cambiare lo slug di un articolo pubblicato cambia il suo indirizzo: i link già condivisi smetteranno di funzionare." : "Generato dal titolo e dalla data se lasci vuoto."} />
            <p className="text-sm text-muted">Titolo e descrizione della pagina sono il titolo e il sommario dell'articolo.</p>
          </FormSection>
        </>
      )}
    </>
  );
}

export const newsConfig: CollectionConfig<Item> = {
  doc: "news",
  list: ["news"],
  title: "News",
  eyebrow: "Editoriale",
  icon: Newspaper,
  singular: "articolo",
  collection: "news",
  itemTitle: (i) => str(i.title),
  itemSubtitle: (i) => [formatDate(i.date), i.author].filter(Boolean).join(" · "),
  thumb: (i) => i.image,
  thumbShape: "wide",
  badges: (i) => (
    <>
      {i.pinned ? <Badge tone="primary">In evidenza</Badge> : null}
      {(Array.isArray(i.tags) ? i.tags : []).slice(0, 2).map((t) => <Badge key={String(t)}>{String(t)}</Badge>)}
    </>
  ),
  search: (i) => [i.title, i.category, i.tags, i.author, i.excerpt],
  sort: (a, b) => str(b.date).localeCompare(str(a.date)),
  filters: [
    { id: "all", label: "Tutte", test: () => true },
    { id: "pinned", label: "In evidenza", test: (i) => !!i.pinned },
  ],
  editor: {
    title: (v) => str(v.title) || "Nuovo articolo",
    create: () => ({ title: "", category: "Club", tags: [], date: todayIso(), author: "", image: "", excerpt: "", pinned: false, contentDoc: { type: "doc", content: [{ type: "paragraph" }] } }),
    summary: (v, isNew) => `${isNew ? "Nuova news" : "Aggiorna news"}: ${str(v.title)}`,
    position: "start",
    wide: true,
    serialize: (v) => {
      const out = { ...v };
      if (!out.contentDoc) out.contentDoc = legacyNewsToDoc(v);
      // bodyHtml and body are regenerated by the server from contentDoc.
      delete out.bodyHtml;
      if (!out.slug) delete out.slug;
      return out;
    },
    children: (v, set) => <NewsForm value={v} set={set as (k: string, x: unknown) => void} />,
  },
};

export const NewsPage = () => <CollectionPage config={newsConfig} />;
