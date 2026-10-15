import { ImageIcon, Plus } from "lucide-react";
import { getAt } from "@shared/json";
import { FormSection, ItemEditor } from "@/components/editor";
import { ImageField, StringListField, TextField } from "@/components/fields";
import { ObjectEditor } from "@/components/object-editor";
import { DraftBanner, PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { useDocument } from "@/lib/docs";
import { setQuery, useRoute } from "@/lib/router";
import { imageUrl } from "@/lib/utils";

type Item = Record<string, unknown>;
const LIST = ["clubHistory", "images"];

export function ClubHistoryPage() {
  const route = useRoute();
  const { content, isLoading, hasDraft } = useDocument("clubHistory");
  const images = ((content && getAt(content, LIST)) as Item[] | undefined) || [];
  const editId = route.query.get("edit");
  const editing = editId && editId !== "new" ? images.find((i) => String(i.id) === editId) || null : null;
  return (
    <>
      <PageHeader title="Storia del club" eyebrow="Club" />
      <DraftBanner doc="clubHistory" />
      {isLoading ? <Skeleton className="h-80" /> : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
          <ObjectEditor<{ title: string; paragraphs: string[] }> doc="clubHistory" path={["clubHistory"]} source={content} keys={["title", "paragraphs"]} hasDraft={hasDraft} summary="Aggiorna la storia del club">
            {(v, set) => (
              <>
                <TextField label="Titolo" value={v.title} onChange={(x) => set("title", x)} />
                <StringListField label="Testo (un paragrafo per riquadro)" multiline value={v.paragraphs} onChange={(x) => set("paragraphs", x)} addLabel="Paragrafo" />
              </>
            )}
          </ObjectEditor>
          <FormSection title="Immagini storiche" action={<Button size="sm" variant="secondary" onClick={() => setQuery({ edit: "new" })}><Plus />Aggiungi</Button>}>
            <ul className="grid grid-cols-2 gap-3">
              {images.map((img) => (
                <li key={String(img.id)}>
                  <Card className="overflow-hidden">
                    <button type="button" className="w-full text-left" onClick={() => setQuery({ edit: String(img.id) })}>
                      {img.image ? <img src={imageUrl(img.image)} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" /> : <span className="grid aspect-[4/3] place-items-center bg-surface-2 text-muted"><ImageIcon /></span>}
                      <span className="block px-3 py-2 text-sm font-semibold">{String(img.season || "—")}</span>
                    </button>
                  </Card>
                </li>
              ))}
            </ul>
          </FormSection>
        </div>
      )}
      <ItemEditor<Item>
        doc="clubHistory"
        list={LIST}
        item={editing}
        open={!!editId && (editId === "new" || !!editing)}
        onClose={() => setQuery({ edit: null }, { force: true })}
        hasDraft={hasDraft}
        title={(v) => String(v.season || "Nuova immagine")}
        create={() => ({ season: "", image: "" })}
        summary={(v, isNew) => `${isNew ? "Aggiungi" : "Aggiorna"} immagine storica ${String(v.season)}`}
      >
        {(v, set) => (
          <>
            <TextField label="Stagione" required value={v.season} onChange={(x) => set("season", x)} placeholder="2011/12" />
            <ImageField label="Immagine" value={v.image} onChange={(x) => set("image", x)} profile="gallery" crop={false} />
          </>
        )}
      </ItemEditor>
    </>
  );
}
