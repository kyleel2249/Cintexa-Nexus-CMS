import { useGetMenus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Menu as MenuIcon, Edit2, Link as LinkIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Menus() {
  const { data: menus, isLoading } = useGetMenus();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Navigation Menus</h2>
          <p className="text-muted-foreground mt-1">Manage your site's navigation structures.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Menu
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isLoading ? (
          Array(2).fill(0).map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/50">
              <CardHeader>
                <Skeleton className="h-6 w-1/3 mb-2" />
                <Skeleton className="h-4 w-1/4" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : menus?.length ? (
          menus.map((menu) => {
            const items = JSON.parse(menu.items || "[]");
            return (
              <Card key={menu.id} className="border-border/50 bg-card flex flex-col">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <MenuIcon className="h-4 w-4 text-primary" />
                      {menu.name}
                    </CardTitle>
                    <CardDescription>Location: {menu.location}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm">
                    <Edit2 className="h-3 w-3 mr-2" />
                    Edit
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 bg-secondary/20 m-6 p-4 rounded-md border border-border/50">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Menu Items</h4>
                    {items.map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-background border border-border/50 rounded-md text-sm">
                        <span className="font-medium">{item.label}</span>
                        <Badge variant="secondary" className="flex items-center gap-1 text-[10px]">
                          <LinkIcon className="h-3 w-3" />
                          {item.url}
                        </Badge>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className="text-sm text-muted-foreground italic text-center py-2">No items in this menu.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-lg">
            <MenuIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium">No menus configured</h3>
            <p className="text-muted-foreground mb-4">Create your first navigation menu.</p>
            <Button>Create Menu</Button>
          </div>
        )}
      </div>
    </div>
  );
}