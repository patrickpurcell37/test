/**
 * lib/pdf-generator.js
 *
 * Generates a visually premium PDF from an earnings call summary.
 * Uses Puppeteer (headless Chrome) to render styled HTML → PDF.
 *
 * Design: Professional equity research report aesthetic —
 * dark navy header, color-coded metrics, clean typography.
 */

import { marked } from "marked";
import fs from "fs/promises";
import path from "path";

// ─── Signal Detection ────────────────────────────────────────────────────────

function detectSignal(text) {
  const u = text.toUpperCase();
  // Look for explicit tone/verdict markers from the skill template
  if (u.match(/TONE\s*:.*BULLISH/) || u.match(/RESULT\s*:.*BEAT.*BEAT/)) return "bullish";
  if (u.match(/TONE\s*:.*BEARISH/) || u.match(/TONE\s*:.*DEFENSIVE/) || u.match(/RESULT\s*:.*MISS.*MISS/)) return "bearish";
  if (u.match(/TONE\s*:.*CAUTIOUS/) || u.match(/TONE\s*:.*MIXED/)) return "mixed";
  // Fallback: count bullish vs bearish signals
  const bulls = (u.match(/BEAT|BULLISH|ACCELERAT|STRONG|RECORD/g) || []).length;
  const bears = (u.match(/MISS|BEARISH|DECELER|WEAK|CONCERN|RISK/g) || []).length;
  if (bulls > bears + 2) return "bullish";
  if (bears > bulls + 2) return "bearish";
  return "mixed";
}

const SIGNAL_STYLES = {
  bullish: { headerBg: "#0a2e1a", accent: "#16a34a", badge: "#dcfce7", badgeText: "#166534", label: "🟢 BULLISH" },
  bearish: { headerBg: "#2a0a0a", accent: "#dc2626", badge: "#fee2e2", badgeText: "#991b1b", label: "🔴 BEARISH" },
  mixed:   { headerBg: "#0f172a", accent: "#2563eb", badge: "#dbeafe", badgeText: "#1e40af", label: "🔵 MIXED / NEUTRAL" },
};

// ─── Marked Renderer ─────────────────────────────────────────────────────────

function buildHtmlContent(markdown) {
  // Custom renderer for better PDF styling
  const renderer = new marked.Renderer();

  renderer.heading = ({ text, depth }) => {
    // Map emoji-prefixed headings to styled section headers
    if (depth === 3) {
      return `<div class="section-header">${text}</div>`;
    }
    return `<h${depth} class="h${depth}">${text}</h${depth}>`;
  };

  renderer.table = ({ header, rows }) => {
    // Build thead from header
    const theadCells = header
      .map(h => `<th>${h.text}</th>`)
      .join("");

    // Build tbody from rows
    const tbodyRows = rows
      .map((row, i) =>
        `<tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">${row.map(cell => {
          const txt = cell.text;
          // Color-code signal cells
          let cls = "";
          if (txt === "✅ BEAT") cls = "signal-beat";
          else if (txt === "❌ MISS") cls = "signal-miss";
          else if (txt === "⚠️ IN-LINE") cls = "signal-inline";
          else if (txt.includes("HIGH")) cls = "risk-high";
          else if (txt.includes("MED")) cls = "risk-med";
          else if (txt.includes("LOW")) cls = "risk-low";
          return `<td class="${cls}">${txt}</td>`;
        }).join("")}</tr>`
      )
      .join("");

    return `<div class="table-wrap">
      <table>
        <thead><tr>${theadCells}</tr></thead>
        <tbody>${tbodyRows}</tbody>
      </table>
    </div>`;
  };

  renderer.blockquote = ({ text }) =>
    `<blockquote>${text}</blockquote>`;

  renderer.code = ({ text }) =>
    `<div class="header-block"><pre>${text}</pre></div>`;

  renderer.hr = () => `<hr class="section-divider">`;

  marked.setOptions({ renderer });
  return marked.parse(markdown);
}

// ─── HTML Template ────────────────────────────────────────────────────────────

function buildFullHtml({ htmlBody, companyName, ticker, quarter, eventDate, signal }) {
  const s = SIGNAL_STYLES[signal];
  const generatedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${companyName} (${ticker}) Earnings Summary</title>
<style>
  /* ── Reset & Base ──────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13.5px;
    line-height: 1.65;
    color: #1e293b;
    background: #f1f5f9;
  }

  /* ── Cover Header ──────────────────────────────── */
  .cover-header {
    background: ${s.headerBg};
    color: white;
    padding: 36px 48px 28px;
    page-break-after: avoid;
    position: relative;
    overflow: hidden;
  }

  .cover-header::before {
    content: "";
    position: absolute;
    top: 0; right: 0; bottom: 0;
    width: 6px;
    background: ${s.accent};
  }

  .cover-header .top-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .company-block .company-name {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: #f8fafc;
  }

  .company-block .ticker-chip {
    display: inline-block;
    background: ${s.accent};
    color: white;
    font-size: 13px;
    font-weight: 700;
    font-family: "SF Mono", "Fira Code", monospace;
    padding: 3px 10px;
    border-radius: 4px;
    margin-left: 12px;
    vertical-align: middle;
    letter-spacing: 0.5px;
  }

  .company-block .sub-line {
    color: #94a3b8;
    font-size: 13px;
    margin-top: 6px;
  }

  .verdict-badge {
    background: ${s.badge};
    color: ${s.badgeText};
    font-size: 13px;
    font-weight: 700;
    padding: 8px 16px;
    border-radius: 6px;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 24px;
  }

  .cover-header .branding {
    display: flex;
    align-items: center;
    gap: 16px;
    border-top: 1px solid rgba(255,255,255,0.1);
    padding-top: 16px;
    margin-top: 4px;
  }

  .branding-tag {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .branding-sep {
    width: 1px;
    height: 12px;
    background: #334155;
  }

  /* ── Main Content Area ─────────────────────────── */
  .content {
    padding: 32px 48px 48px;
    background: #f1f5f9;
  }

  /* ── Section Headers (h3 with emoji) ───────────── */
  .section-header {
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
    padding: 10px 16px;
    background: #ffffff;
    border-left: 4px solid ${s.accent};
    border-radius: 0 6px 6px 0;
    margin: 28px 0 14px;
    letter-spacing: -0.2px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    page-break-after: avoid;
  }

  .h1, .h2 {
    font-size: 18px;
    font-weight: 700;
    color: #0f172a;
    margin: 24px 0 12px;
    page-break-after: avoid;
  }

  .h2 { font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }

  /* ── Paragraphs ─────────────────────────────────── */
  p { margin: 8px 0; color: #334155; }

  /* ── Inline code (Header Block from skill) ─────── */
  .header-block {
    background: #0f172a;
    border-radius: 8px;
    padding: 20px 24px;
    margin: 16px 0 24px;
    page-break-inside: avoid;
  }

  .header-block pre {
    font-family: "SF Mono", "Fira Code", "Courier New", monospace;
    font-size: 12px;
    color: #e2e8f0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.7;
  }

  /* ── Tables ─────────────────────────────────────── */
  .table-wrap {
    overflow-x: auto;
    margin: 12px 0 20px;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    page-break-inside: avoid;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    font-size: 12.5px;
  }

  thead tr {
    background: #1e293b;
    color: #f1f5f9;
  }

  thead th {
    padding: 10px 14px;
    text-align: left;
    font-weight: 600;
    font-size: 11.5px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    white-space: nowrap;
  }

  tbody td {
    padding: 9px 14px;
    border-bottom: 1px solid #f1f5f9;
    color: #334155;
  }

  .row-even { background: #ffffff; }
  .row-odd  { background: #f8fafc; }

  tbody tr:last-child td { border-bottom: none; }

  /* Signal cells */
  .signal-beat   { color: #16a34a; font-weight: 700; }
  .signal-miss   { color: #dc2626; font-weight: 700; }
  .signal-inline { color: #d97706; font-weight: 600; }
  .risk-high     { color: #dc2626; font-weight: 700; }
  .risk-med      { color: #d97706; font-weight: 600; }
  .risk-low      { color: #16a34a; font-weight: 600; }

  /* ── Blockquotes (for management quotes) ───────── */
  blockquote {
    border-left: 3px solid ${s.accent};
    background: #f8fafc;
    margin: 14px 0;
    padding: 12px 18px;
    border-radius: 0 6px 6px 0;
    color: #475569;
    font-style: italic;
    page-break-inside: avoid;
  }

  blockquote strong { color: #1e293b; font-style: normal; }

  /* ── Lists ──────────────────────────────────────── */
  ul, ol {
    padding-left: 22px;
    margin: 8px 0 12px;
  }

  li {
    margin: 4px 0;
    color: #334155;
  }

  li strong { color: #1e293b; }

  /* ── Dividers ───────────────────────────────────── */
  .section-divider {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 24px 0;
  }

  hr { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }

  /* ── Inline emphasis ────────────────────────────── */
  strong { color: #1e293b; font-weight: 600; }
  em { color: #64748b; }
  code {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 12px;
    background: #f1f5f9;
    padding: 1px 5px;
    border-radius: 3px;
    color: #2563eb;
  }

  /* ── Page breaks ────────────────────────────────── */
  @media print {
    .cover-header { page-break-after: avoid; }
    .section-header { page-break-after: avoid; }
    .table-wrap { page-break-inside: avoid; }
    .header-block { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<!-- ── Cover Header ──────────────────────────────── -->
<div class="cover-header">
  <div class="top-row">
    <div class="company-block">
      <div>
        <span class="company-name">${companyName}</span>
        <span class="ticker-chip">${ticker}</span>
      </div>
      <div class="sub-line">${quarter || "Earnings Call"} &nbsp;·&nbsp; ${eventDate || generatedDate}</div>
    </div>
    <div class="verdict-badge">${SIGNAL_STYLES[signal].label}</div>
  </div>
  <div class="branding">
    <span class="branding-tag">Earnings Call Summary</span>
    <div class="branding-sep"></div>
    <span class="branding-tag">Claude AI · Extended Thinking</span>
    <div class="branding-sep"></div>
    <span class="branding-tag">Generated ${generatedDate}</span>
  </div>
</div>

<!-- ── Analysis Body ─────────────────────────────── -->
<div class="content">
  ${htmlBody}
</div>

</body>
</html>`;
}

// ─── PDF Generator ────────────────────────────────────────────────────────────

/**
 * Generates a PDF from an earnings summary markdown string.
 *
 * @param {object} opts
 * @param {string} opts.summaryMarkdown  - The full summary text
 * @param {string} opts.companyName
 * @param {string} opts.ticker
 * @param {string} opts.quarter          - e.g. "Q4 FY2025"
 * @param {string} opts.eventDate        - e.g. "2025-02-26"
 * @param {string} opts.outputPath       - Full path to write the .pdf
 * @returns {Promise<string>}            - Resolves to outputPath
 */
export async function generatePdf({ summaryMarkdown, companyName, ticker, quarter, eventDate, outputPath }) {
  // Dynamic import so the module loads even if puppeteer isn't installed
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch {
    throw new Error(
      "puppeteer not installed. Run: npm install puppeteer\n" +
      "Then re-run the summarizer."
    );
  }

  const signal = detectSignal(summaryMarkdown);
  const htmlBody = buildHtmlContent(summaryMarkdown);
  const fullHtml = buildFullHtml({ htmlBody, companyName, ticker, quarter, eventDate, signal });

  // Launch headless Chrome
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",  // Required in Docker/CI
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();

    // Set viewport to A4-ish width (794px = 210mm at 96dpi)
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1.5 });

    await page.setContent(fullHtml, { waitUntil: "networkidle0" });

    // Small pause to ensure fonts/layout settle
    await new Promise((r) => setTimeout(r, 200));

    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "14mm", left: "0" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="font-family:-apple-system,sans-serif;font-size:9px;color:#94a3b8;
                    text-align:center;width:100%;padding:0 0 6px">
          ${companyName} (${ticker}) · ${quarter || "Earnings"} · Powered by Claude AI &nbsp;|&nbsp;
          Page <span class="pageNumber"></span> of <span class="totalPages"></span>
        </div>`,
    });

    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * Save the HTML version of the report (useful for debugging or email inline).
 */
export async function generateHtml({ summaryMarkdown, companyName, ticker, quarter, eventDate, outputPath }) {
  const signal = detectSignal(summaryMarkdown);
  const htmlBody = buildHtmlContent(summaryMarkdown);
  const fullHtml = buildFullHtml({ htmlBody, companyName, ticker, quarter, eventDate, signal });

  // Ensure directory exists
  const { mkdir } = await import("fs/promises");
  await mkdir(path.dirname(outputPath), { recursive: true });

  const { writeFile } = await import("fs/promises");
  await writeFile(outputPath, fullHtml, "utf-8");
  return outputPath;
}
