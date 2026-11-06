import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Module foundation is in place. Full workflow is being completed against the shared Nexus data layer.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming online</CardTitle>
          <CardDescription>
            This section will use the same campaign, content, audience and sync infrastructure as the rest of Marketing Management.
            No external marketing APIs are required.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use <strong>Campaign Manager</strong> and <strong>Marketing Overview</strong> for the current working surface.
        </CardContent>
      </Card>
    </div>
  );
}
