import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Owner sign in — Release Engine Solo" },
      { name: "description", content: "Sign in to your self-hosted Release Engine studio." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

/**
 * Solo Edition: single-owner sign-in. There is no sign-up form, and the
 * database refuses to create a second account, so this installation cannot
 * be operated as a multi-user service.
 */
function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/projects" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/projects" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
  }

  async function handleReset() {
    if (!email) return toast.error("Enter your email first");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined,
    });
    if (error) return toast.error(error.message);
    toast.success("Password reset email sent");
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="flex justify-center"><Brand /></div>
        <h1 className="mt-8 text-center font-display text-2xl">Owner sign in</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          This studio has a single owner account.
        </p>

        <form onSubmit={handleSignIn} className="mt-8 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <button type="button" onClick={handleReset}
          className="mt-4 w-full text-center text-xs text-muted-foreground underline underline-offset-4">
          Forgot your password?
        </button>

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Haven't finished installing? Open <span className="font-mono">/setup</span>.
        </p>
      </div>
    </div>
  );
}