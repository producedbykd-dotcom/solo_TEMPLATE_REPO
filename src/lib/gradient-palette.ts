export type GradientPaletteId = "engine" | "neon" | "aurora" | "miami" | "volt";

export const GRADIENT_PALETTES: Array<{
  id: GradientPaletteId;
  name: string;
  className: string;
  swatch: string;
}> = [
  {
    id: "engine",
    name: "Engine",
    className: "re-palette-engine",
    swatch: "linear-gradient(135deg, #fff7dd 0%, #7c3aed 52%, #fb923c 100%)",
  },
  {
    id: "neon",
    name: "Neon",
    className: "re-palette-neon",
    swatch: "linear-gradient(135deg, #67e8f9 0%, #2563eb 48%, #a3e635 100%)",
  },
  {
    id: "aurora",
    name: "Aurora",
    className: "re-palette-aurora",
    swatch: "linear-gradient(135deg, #34d399 0%, #14b8a6 46%, #a78bfa 100%)",
  },
  {
    id: "miami",
    name: "Miami",
    className: "re-palette-miami",
    swatch: "linear-gradient(135deg, #f0abfc 0%, #ec4899 44%, #f97316 100%)",
  },
  {
    id: "volt",
    name: "Volt",
    className: "re-palette-volt",
    swatch: "linear-gradient(135deg, #fde047 0%, #22c55e 48%, #06b6d4 100%)",
  },
];

export const GRADIENT_PALETTE_KEY = "re:gradient-palette";

export function normalizeGradientPalette(value: string | null | undefined): GradientPaletteId {
  return GRADIENT_PALETTES.some((p) => p.id === value) ? (value as GradientPaletteId) : "neon";
}

export function applyGradientPalette(id: GradientPaletteId) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const palette of GRADIENT_PALETTES) root.classList.remove(palette.className);
  root.classList.add(GRADIENT_PALETTES.find((p) => p.id === id)?.className ?? "re-palette-volt");
}