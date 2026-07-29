import { Link } from "@tanstack/react-router";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      {!small && (
        <span className="font-display text-lg font-semibold tracking-tight">
          RELEASE{"\u00a0"}
          <span className="bg-[image:var(--gradient-accent-text)] bg-clip-text text-transparent">
            ENGINE
          </span>
          {" "}A.I
        </span>
      )}
    </Link>
  );
}