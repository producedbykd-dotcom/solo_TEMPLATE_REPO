import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Library, Plug, LogOut, UserCircle2, Layers, Menu, Store } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GradientPalettePicker } from "@/components/GradientPalettePicker";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth" });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const nav = [
    { to: "/projects", label: "Projects", icon: LayoutGrid },
    { to: "/catalog", label: "Catalog", icon: Library },
    { to: "/compilations", label: "Compilations", icon: Layers },
    { to: "/store", label: "My Store", icon: Store },
    { to: "/identities", label: "Identities", icon: UserCircle2 },
    { to: "/connections", label: "Connections", icon: Plug },
  ] as const;

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const SidebarBody = () => (
    <>
      <div className="px-2 py-2"><Brand /></div>
      <nav className="mt-6 flex flex-col gap-1">
        {nav.map(({ to, label, icon: Icon }) => {
          const active = path.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-lg border border-border bg-card/60 p-3 text-xs">
        <p className="truncate text-muted-foreground">{email ?? "—"}</p>
        <ThemeToggle className="mt-2" />
        <GradientPalettePicker className="mt-1" />
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 w-full justify-start px-2 text-xs"
          onClick={signOut}
        >
          <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="relative flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 flex-col border-r border-border bg-sidebar/80 p-4 backdrop-blur md:flex">
        <SidebarBody />
      </aside>
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:hidden">
        <Brand />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-64 flex-col p-4">
            <VisuallyHidden><SheetTitle>Navigation</SheetTitle></VisuallyHidden>
            <SidebarBody />
          </SheetContent>
        </Sheet>
      </div>
      <main className="relative z-10 min-h-screen flex-1 pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}