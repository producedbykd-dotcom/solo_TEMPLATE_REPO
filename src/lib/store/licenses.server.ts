/**
 * Server-only PDF licence generation.
 * Uses a tiny dependency-free PDF writer (base-14 Helvetica, text only) so the
 * Worker bundle stays free of CommonJS/tslib interop issues.
 * One PDF per purchased licensed item, personalised with buyer + producer.
 */
import type { TierKind } from "./pricing";

export type LicenseTerms = {
  streamLimit: number | null;
  distributionLimit: number | null;
  videoLimit: number | null;
  termMonths: number | null;
  extraTerms: string | null;
};

export type LicenseInput = {
  tierKind: TierKind;
  trackTitle: string;
  buyerName: string;
  buyerEmail: string;
  producerName: string;
  orderId: string;
  pricePaid: string;
  purchasedAt: Date;
  terms: LicenseTerms;
};

function limitText(n: number | null, unit: string): string {
  if (n === null || n === undefined) return `unlimited ${unit}`;
  return `${n.toLocaleString("en-US")} ${unit}`;
}

function bodyFor(input: LicenseInput): { heading: string; clauses: string[] } {
  const { terms } = input;
  const term = terms.termMonths ? `${terms.termMonths} months from the purchase date` : "perpetual";
  const common = [
    `1. GRANT. The Producer grants the Licensee ${input.tierKind === "exclusive" ? "an exclusive" : "a non-exclusive"}, worldwide licence to use the musical composition and sound recording titled "${input.trackTitle}" (the "Beat") subject to the terms below.`,
    `2. TERM. This licence is ${term}.`,
    `3. USE. The Licensee may record vocals over the Beat and distribute the resulting song commercially within the limits stated in this agreement.`,
    `4. LIMITS. Audio streams: ${limitText(terms.streamLimit, "streams")}. Distribution copies (downloads / physical units): ${limitText(terms.distributionLimit, "copies")}. Monetised music videos: ${limitText(terms.videoLimit, "videos")}.`,
    `5. CREDIT. The Licensee must credit the Producer as "Prod. ${input.producerName}" in the song title or description wherever the song appears.`,
    `6. RESTRICTIONS. The Licensee may not resell, re-license, or redistribute the Beat in its original instrumental form, nor register it with any content identification system as their own work.`,
  ];

  if (input.tierKind === "exclusive") {
    return {
      heading: "EXCLUSIVE LICENCE AGREEMENT",
      clauses: [
        ...common,
        `7. EXCLUSIVITY. Upon payment the Beat is removed from sale. The Producer will not licence the Beat to any other party after this date. Licences issued before this date remain valid.`,
        `8. OWNERSHIP. The Producer retains authorship and the writer's share of the underlying composition unless separately agreed in writing.`,
      ],
    };
  }
  return {
    heading: "NON-EXCLUSIVE LICENCE AGREEMENT",
    clauses: [
      ...common,
      `7. NON-EXCLUSIVITY. The Producer retains full ownership of the Beat and may continue to licence or sell it to other parties.`,
      `8. UPGRADE. Amounts paid under this licence may be credited toward an exclusive licence at the Producer's discretion.`,
    ],
  };
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

/** ASCII-safe: the built-in Helvetica font cannot encode smart quotes/dashes. */
function ascii(s: string): string {
  return (s || "")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E]/g, "");
}

type Rgb = [number, number, number];

/** Escapes a string for a PDF literal string object. */
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Minimal single-font-family PDF writer: A4 pages, Helvetica / Helvetica-Bold. */
function renderPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve 1 = catalog, 2 = pages tree.
  add("");
  add("");
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const pageRefs: number[] = [];
  for (const ops of pages) {
    const stream = ops.join("\n");
    const contentRef = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageRef = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
        `/Contents ${contentRef} 0 R >>`,
    );
    pageRefs.push(pageRef);
  }

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] =
    `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

export async function buildLicensePdf(input: LicenseInput): Promise<Uint8Array> {
  const { heading, clauses } = bodyFor(input);

  const margin = 56;
  const ink: Rgb = [0.08, 0.08, 0.1];
  const soft: Rgb = [0.42, 0.42, 0.48];

  const pages: string[][] = [[]];
  let ops = pages[0];
  let y = 842 - margin;

  const line = (text: string, size: number, f: "F1" | "F2" = "F1", color: Rgb = ink, gap = 6) => {
    if (y < margin + 40) {
      ops = [];
      pages.push(ops);
      y = 842 - margin;
    }
    ops.push(
      `BT /${f} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ` +
        `${margin} ${y.toFixed(2)} Td (${pdfEscape(ascii(text))}) Tj ET`,
    );
    y -= size + gap;
  };
  const font = "F1" as const;
  const bold = "F2" as const;

  line(heading, 16, bold);
  line(`Issued ${input.purchasedAt.toUTCString().slice(0, 16)}  -  Order ${input.orderId.slice(0, 8).toUpperCase()}`, 9, font, soft, 16);

  line("PARTIES", 10, bold, ink, 8);
  line(`Producer / Licensor: ${input.producerName}`, 10);
  line(`Licensee: ${input.buyerName} (${input.buyerEmail})`, 10);
  line(`Track: ${input.trackTitle}`, 10);
  line(`Consideration paid: ${input.pricePaid}`, 10, font, ink, 16);

  line("TERMS", 10, bold, ink, 8);
  for (const clause of clauses) {
    for (const l of wrap(clause, 95)) line(l, 9.5, font, ink, 3);
    y -= 6;
  }
  if (input.terms.extraTerms?.trim()) {
    line("ADDITIONAL TERMS", 10, bold, ink, 8);
    for (const l of wrap(input.terms.extraTerms, 95)) line(l, 9.5, font, ink, 3);
    y -= 6;
  }

  y -= 18;
  line("ACCEPTANCE", 10, bold, ink, 8);
  for (const l of wrap(
    `This agreement is executed electronically. Completion of payment by the Licensee on ${input.purchasedAt.toUTCString().slice(0, 16)} constitutes acceptance of all terms above by both parties.`,
    95,
  )) line(l, 9.5, font, ink, 3);
  y -= 14;
  line(`Producer: ${input.producerName}`, 9.5, font, soft, 3);
  line(`Licensee: ${input.buyerName}`, 9.5, font, soft, 3);

  return renderPdf(pages);
}