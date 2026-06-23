import { useState } from "react";
import { useGetMedia } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Search, Image as ImageIcon, File, Film } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Media() {
  const [filter, setFilter] = useState("all");
  const { data: mediaItems, isLoading } = useGetMedia({ type: filter !== "all" ? filter : undefined });

  const getIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="h-8 w-8 text-primary/50" />;
    if (mimeType.startsWith('video/')) return <Film className="h-8 w-8 text-primary/50" />;
    return <File className="h-8 w-8 text-primary/50" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-6 h-[calc(100vh-10rem)] flex flex-col">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Media Library</h2>
          <p className="text-muted-foreground mt-1">Manage all your images, documents, and videos.</p>
        </div>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          Upload Files
        </Button>
      </div>

      <div className="flex items-center justify-between flex-shrink-0">
        <Tabs defaultValue="all" value={filter} onValueChange={setFilter}>
          <TabsList className="bg-card border border-border/50">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="images">Images</TabsTrigger>
            <TabsTrigger value="videos">Videos</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search media..." className="pl-9 bg-card" />
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0 bg-card border border-border/50 rounded-lg p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {isLoading ? (
            Array(10).fill(0).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))
          ) : mediaItems?.length ? (
            mediaItems.map((item) => (
              <div 
                key={item.id} 
                className="group relative aspect-square rounded-md border border-border/50 overflow-hidden bg-secondary/20 hover:border-primary/50 cursor-pointer transition-colors"
              >
                {item.mimeType.startsWith('image/') && item.url ? (
                  <img 
                    src={item.url} 
                    alt={item.altText || item.filename} 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {getIcon(item.mimeType)}
                  </div>
                )}
                
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                  <p className="text-sm font-medium truncate" title={item.filename}>{item.filename}</p>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-xs text-muted-foreground">{formatSize(item.size)}</span>
                    <span className="text-xs text-muted-foreground uppercase">{item.mimeType.split('/')[1] || 'FILE'}</span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full h-64 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border/50 rounded-lg">
              <ImageIcon className="h-12 w-12 mb-4 opacity-50" />
              <p>No media files found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}