import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, Save, Key, Shield, Webhook } from "lucide-react";

export default function Settings() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">System Settings</h2>
          <p className="text-muted-foreground mt-1">Configure global platform behavior and integrations.</p>
        </div>
        <Button>
          <Save className="mr-2 h-4 w-4" />
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="space-y-1 lg:col-span-1">
          <Button variant="ghost" className="w-full justify-start bg-secondary/50 text-foreground font-medium">
            <SettingsIcon className="mr-2 h-4 w-4" /> General
          </Button>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground">
            <Key className="mr-2 h-4 w-4" /> API Keys
          </Button>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground">
            <Webhook className="mr-2 h-4 w-4" /> Webhooks
          </Button>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground">
            <Shield className="mr-2 h-4 w-4" /> Security
          </Button>
        </div>

        <div className="lg:col-span-3 space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle>Platform Configuration</CardTitle>
              <CardDescription>Core settings for the CINTEXA CMS platform.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Platform Name</Label>
                <Input defaultValue="CINTEXA CMS" />
              </div>
              
              <div className="space-y-2">
                <Label>Support Email</Label>
                <Input defaultValue="support@cintexa.com" type="email" />
              </div>

              <div className="pt-4 border-t border-border/50 space-y-4">
                <h4 className="text-sm font-semibold">Features</h4>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Maintenance Mode</Label>
                    <p className="text-sm text-muted-foreground">Disables public access to all connected sites.</p>
                  </div>
                  <Switch />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>User Registration</Label>
                    <p className="text-sm text-muted-foreground">Allow new users to sign up automatically.</p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>AI Features</Label>
                    <p className="text-sm text-muted-foreground">Enable the AI Studio and inline generation tools.</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}