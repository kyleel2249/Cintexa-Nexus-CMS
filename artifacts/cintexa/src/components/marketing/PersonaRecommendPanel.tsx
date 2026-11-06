import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { marketingIntel } from "@/lib/marketing/api";

type Props = {
  personaId?: number | null;
  onSelectPersona?: (id: number) => void;
};

export function PersonaRecommendPanel({ personaId, onSelectPersona }: Props) {
  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const personas = useQuery({ queryKey: ["mkt", "personas"], queryFn: () => marketingIntel.listPersonas() });
  const list = personas.data?.items || [];
  const selected = list.find((p) => p.id === personaId) || list[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Persona guidance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <select
          className="w-full h-9 rounded-md border bg-background px-2 text-sm"
          value={selected?.id ?? ""}
          onChange={(e) => onSelectPersona?.(Number(e.target.value))}
        >
          {list.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {selected ? (
          <>
            <p className="text-xs text-muted-foreground">{selected.category} · {selected.role}</p>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Pain points</p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {(selected.pain_points || []).slice(0, 6).map((x) => (
                  <Badge key={x} variant="outline" className="text-[10px]">{x}</Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Motivations</p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {(selected.motivations || []).slice(0, 6).map((x) => (
                  <Badge key={x} variant="secondary" className="text-[10px]">{x}</Badge>
                ))}
              </div>
            </div>
            {selected.recommended_message && (
              <p className="text-xs border rounded p-2 bg-muted/30">{selected.recommended_message}</p>
            )}
            <p className="text-[10px] text-muted-foreground">
              Channels: {(selected.preferred_channels || []).join(", ") || "—"} · Recommendation only, not verified performance.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No personas in local store.</p>
        )}
      </CardContent>
    </Card>
  );
}
