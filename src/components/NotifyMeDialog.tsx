import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: string;       // e.g. "facebook", "tiktok", "soundcloud"
  platformLabel: string;  // e.g. "Facebook & Instagram"
  certifierLabel: string; // e.g. "Meta", "TikTok", "SoundCloud"
};

export function NotifyMeDialog({ open, onOpenChange, platform, platformLabel, certifierLabel }: Props) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail((cur) => cur || data.user!.email!);
    });
  }, [open]);

  async function submit() {
    const value = email.trim().toLowerCase();
    if (!value || !value.includes("@")) {
      toast.error("Enter a valid email");
      return;
    }
    setSubmitting(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("notify_signups")
      .insert({ email: value, platform, user_id: u.user?.id ?? null });
    setSubmitting(false);
    if (error && !error.message.toLowerCase().includes("duplicate")) {
      toast.error(error.message);
      return;
    }
    setDone(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{platformLabel} — coming soon</DialogTitle>
          <DialogDescription>
            This connection is coming soon. This app is being certified by {certifierLabel}. This connection will be available soon.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            You'll be notified as soon as it's ready. Thank you for your patience.
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> Email to notify
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoFocus
            />
            <div className="flex justify-end">
              <Button onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Notify me
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}