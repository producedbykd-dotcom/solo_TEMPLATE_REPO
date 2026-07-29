import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "dark" | "light";
const KEY = "re:theme";

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const saved = (typeof window !== "undefined" && (localStorage.getItem(KEY) as Theme | null)) || "dark";
    setTheme(saved);
    apply(saved);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 w-full justify-start px-2 text-xs ${className}`}
      onClick={toggle}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark"
        ? <><Sun className="mr-1.5 h-3.5 w-3.5" /> Light mode</>
        : <><Moon className="mr-1.5 h-3.5 w-3.5" /> Dark mode</>}
    </Button>
  );
}