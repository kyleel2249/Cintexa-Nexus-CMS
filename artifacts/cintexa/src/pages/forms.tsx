import { useGetForms } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, FormInput, Inbox, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Forms() {
  const { data: forms, isLoading } = useGetForms();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Forms</h2>
          <p className="text-muted-foreground mt-1">Manage data collection and form submissions.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Form
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/50">
              <CardHeader>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))
        ) : forms?.length ? (
          forms.map((form) => {
            const fields = JSON.parse(form.fields || "[]");
            return (
              <Card key={form.id} className="border-border/50 bg-card hover:border-primary/50 transition-colors group">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <FormInput className="h-4 w-4 text-primary" />
                        {form.name}
                      </CardTitle>
                      <CardDescription>{fields.length} fields</CardDescription>
                    </div>
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                      <Inbox className="h-3 w-3 mr-1" />
                      {form.submissionCount}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/50">
                    <span>Created {format(new Date(form.createdAt), "MMM d, yyyy")}</span>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-primary">
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 hover:text-primary">
                        View Submissions
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-lg">
            <FormInput className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium">No forms created</h3>
            <p className="text-muted-foreground mb-4">Create your first form to start collecting data.</p>
            <Button>Create Form</Button>
          </div>
        )}
      </div>
    </div>
  );
}