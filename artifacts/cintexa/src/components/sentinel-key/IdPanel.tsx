import { useState } from "react";
import { Download, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RangeField, TextField, ToggleRow, Notice, Stat } from "./ui-bits";
import { SecretField } from "./SecretField";
import { generateRandomId, generateUnique, ID_LIMITS, randomIdEntropyBits, ulid, uuidv4, uuidv5, uuidv7, UUID_NAMESPACES, type RandomIdOptions } from "@/lib/sentinel-key/ids";
import { copyText, downloadText } from "@/lib/sentinel-key/clipboard";
import { useStoredGeneration } from "@/lib/sentinel-key/store/use-stored-generation";
import { StorageControls } from "./StorageControls";

type Kind = "random" | "uuidv4" | "uuidv7" | "ulid" | "uuidv5";
const KIND_INFO: Record<Kind, string> = {
  random: "Custom random identifiers. Suitable as hard-to-guess public IDs when long enough; use the Tokens tab for secrets.",
  uuidv4: "UUID v4: 122 random bits. The common choice for random public identifiers.",
  uuidv7: "UUID v7: time-ordered, so database indexes stay efficient. The timestamp is visible, so it is not a secret.",
  ulid: "ULID: time-ordered, 26 characters, easy to sort. The timestamp is visible, so it is not a secret.",
  uuidv5: "UUID v5: the same namespace and name always produce the same ID. Predictable by design, so never use it as a secret.",
};

export function IdPanel() {
  const sg = useStoredGeneration("id");
  const [kind, setKind] = useState<Kind>("random");
  const [o, setO] = useState<RandomIdOptions>({ length: ID_LIMITS.defaultLength, lower: true, upper: true, digits: true, symbols: false, excludeAmbiguous: false, prefix: "", suffix: "", custom: "", exclude: "" });
  const [count, setCount] = useState(1);
  const [ns, setNs] = useState<keyof typeof UUID_NAMESPACES>("DNS");
  const [name, setName] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const set = (p: Partial<RandomIdOptions>) => setO((x) => ({ ...x, ...p }));

  const generate = async (n = count) => {
    if (kind === "uuidv5" && !name.trim()) { setError("Enter a name to derive the ID from."); return; }
    let out: string[] = [];
    const res = await sg.run(async () => {
      if (kind === "uuidv5") out = [await uuidv5(name, UUID_NAMESPACES[ns])];
      else out = generateUnique(kind === "random" ? () => generateRandomId(o) : kind === "uuidv4" ? uuidv4 : kind === "uuidv7" ? () => uuidv7() : () => ulid(), n);
      return out.join("\n");
    }, { format: kind, ...(kind === "random" ? { length: o.length } : {}) }, kind === "uuidv5" ? 1 : n);
    setNote("");
    if (!res.generated) { setError(res.error ?? "Nothing was generated."); setIds([]); return; }
    setIds(out); setError(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 rounded-xl border bg-card p-4 space-y-4">
        <Tabs value={kind} onValueChange={(v) => { setKind(v as Kind); setIds([]); setError(null); }}>
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="random">Random</TabsTrigger><TabsTrigger value="uuidv4">UUID v4</TabsTrigger><TabsTrigger value="uuidv7">UUID v7</TabsTrigger><TabsTrigger value="ulid">ULID</TabsTrigger><TabsTrigger value="uuidv5">UUID v5</TabsTrigger>
          </TabsList>
          <TabsContent value={kind} className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">{KIND_INFO[kind]}</p>
            {kind === "random" && (
              <>
                <RangeField id="id-length" label="Length" value={o.length} min={ID_LIMITS.minLength} max={ID_LIMITS.maxLength} onChange={(length) => set({ length })} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <ToggleRow id="id-lower" label="Lowercase" checked={!!o.lower} onChange={(lower) => set({ lower })} />
                  <ToggleRow id="id-upper" label="Uppercase" checked={!!o.upper} onChange={(upper) => set({ upper })} />
                  <ToggleRow id="id-digits" label="Numbers" checked={!!o.digits} onChange={(digits) => set({ digits })} />
                  <ToggleRow id="id-symbols" label="Symbols" checked={!!o.symbols} onChange={(symbols) => set({ symbols })} />
                  <ToggleRow id="id-amb" label="Exclude look-alikes" checked={!!o.excludeAmbiguous} onChange={(excludeAmbiguous) => set({ excludeAmbiguous })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField id="id-prefix" label="Prefix" value={o.prefix ?? ""} onChange={(prefix) => set({ prefix })} maxLength={32} />
                  <TextField id="id-suffix" label="Suffix" value={o.suffix ?? ""} onChange={(suffix) => set({ suffix })} maxLength={32} />
                  <TextField id="id-custom" label="Custom characters" value={o.custom ?? ""} onChange={(custom) => set({ custom })} maxLength={64} />
                  <TextField id="id-exclude" label="Never use" value={o.exclude ?? ""} onChange={(exclude) => set({ exclude })} maxLength={64} />
                </div>
              </>
            )}
            {kind === "uuidv5" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><label htmlFor="id-ns" className="text-sm font-medium">Namespace</label>
                  <select id="id-ns" value={ns} onChange={(e) => setNs(e.target.value as keyof typeof UUID_NAMESPACES)} className="h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    {(Object.keys(UUID_NAMESPACES) as (keyof typeof UUID_NAMESPACES)[]).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select></div>
                <TextField id="id-name" label="Name" value={name} onChange={setName} maxLength={1024} placeholder="www.example.com" />
              </div>
            )}
            {kind !== "uuidv5" && <RangeField id="id-count" label="How many" value={count} min={1} max={ID_LIMITS.maxBulk} onChange={setCount} />}
            {kind === "random" && <p className="text-xs text-muted-foreground">About {Math.round(randomIdEntropyBits(o))} bits of randomness per ID.</p>}
          </TabsContent>
        </Tabs>
        <Notice title="IDs are not passwords">Public identifiers tell systems apart. They do not prove who you are. Never use a time-based or name-based ID as a login secret.</Notice>
      </div>

      <div className="lg:col-span-2 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-4 space-y-4 self-start lg:sticky lg:top-20">
        <StorageControls sg={sg} />
        <Button type="button" className="w-full" onClick={() => generate()} disabled={!!sg.blocked || sg.busy}><Fingerprint /> Generate{kind !== "uuidv5" && count > 1 ? ` ${count} IDs` : " ID"}</Button>
        {sg.blocked && <p className="text-xs text-muted-foreground" role="status">{sg.blocked}</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {ids.length <= 1 ? <SecretField label="Generated ID" value={ids[0] ?? null} onRegenerate={sg.blocked ? undefined : () => generate(1)} onClear={() => { setIds([]); sg.clear(); }} />
          : <div className="space-y-2"><ul className="max-h-72 overflow-auto rounded-lg border bg-background p-2 font-mono text-xs space-y-1" aria-label="Generated IDs">{ids.map((i) => <li key={i} className="break-all">{i}</li>)}</ul><Stat label="IDs generated (all unique)" value={ids.length} /></div>}
        {ids.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={async () => setNote((await copyText(ids.join("\n"))) ? "Copied." : "Copy failed.")}>Copy all</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => downloadText("sentinel-key-ids.txt", ids.join("\n") + "\n")}><Download /> Export</Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{note}</p>
      </div>
    </div>
  );
}
