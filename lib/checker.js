/**
 * lib/checker.js
 *
 * Earnings event checker.
 * For each company in the watchlist, detects whether a new earnings call
 * transcript has been published since the last processed date, then
 * orchestrates fetch → summarize → email → state update.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { sendEarningsSummary } from "./email.js";
import { generatePdf } from "./pdf-generator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ─── Message Sanitizer ────────────────────────────────────────────────────
/**
 * Strips trailing whitespace from all text blocks in an assistant response.
 * Also removes empty text blocks. Prevents two Anthropic API errors:
 *   - "messages: final assistant content cannot end with trailing whitespace"
 *   - "This model does not support assistant message prefill"
 */
function sanitizeAssistantContent(content) {
  const cleaned = content
    .map((block) =>
      block.type === "text"
        ? { ...block, text: block.text.trimEnd() }
        : block
    )
    .filter((block) => !(block.type === "text" && block.text === ""));

  // Must always have at least one block or the API rejects the message
  return cleaned.length > 0 ? cleaned : [{ type: "text", text: "." }];
}

// ─── Tool Definitions ──────────────────────────────────────────────────────

const WEB_TOOLS = [
  {
    name: "web_search",
    description: "Search the web for earnings call transcripts.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description: "Fetch the HTML content of a URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTPS URL to fetch" },
      },
      required: ["url"],
    },
  },
];

// ─── Web Helpers ───────────────────────────────────────────────────────────

async function webSearch(query) {
  const encoded = encodeURIComponent(query);
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; EarningsSummarizer/1.0)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const html = await res.text();

  const results = [];
  const blocks = html.split('class="result ').slice(1, 10);
  for (const block of blocks) {
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    if (titleMatch) {
      let url = titleMatch[1];
      if (url.includes("uddg=")) {
        try {
          const uddg = new URL("https://x.com" + url).searchParams.get("uddg");
          if (uddg) url = decodeURIComponent(uddg);
        } catch (_) {}
      }
      results.push({ url, title: titleMatch[2] });
    }
  }
  return { results: results.slice(0, 8) };
}

async function fetchUrl(url) {
  if (!url.startsWith("https://")) throw new Error("Only HTTPS URLs supported");
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
  return { url, content: text.slice(0, 25_000), length: text.length };
}

// ─── Date Helpers ─────────────────────────────────────────────────────────

/** Returns the current quarter and year as context strings for searches. */
function getDateContext() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const q = Math.ceil(month / 3);   // 1-4

  // Previous quarter (wraps year if needed)
  const prevQ = q === 1 ? 4 : q - 1;
  const prevQYear = q === 1 ? year - 1 : year;

  return {
    today: now.toISOString().split("T")[0],           // YYYY-MM-DD
    currentQ: `Q${q} ${year}`,                        // e.g. "Q2 2025"
    prevQ: `Q${prevQ} ${prevQYear}`,                  // e.g. "Q1 2025"
    searchYears: `${prevQYear} OR ${year}`,            // for search queries
    maxAgeDays: 120,                                   // transcripts older than this are too stale
  };
}

/** Returns true if dateStr (YYYY-MM-DD) is within maxAgeDays of today. */
function isWithinFreshnessWindow(dateStr, maxAgeDays) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return true; // can't validate, allow
  const eventMs = new Date(dateStr).getTime();
  const nowMs = Date.now();
  const diffDays = (nowMs - eventMs) / (1000 * 60 * 60 * 24);
  return diffDays <= maxAgeDays;
}

// ─── Phase 1: Discover Candidates ─────────────────────────────────────────

/**
 * Searches for the top transcript candidates and returns their metadata
 * (url, title, date) without fetching full content.
 * Returns an array sorted newest-first.
 */
async function discoverCandidates(client, company, dateCtx, log) {
  const { name, ticker } = company;

  const systemPrompt = `You are a financial data discovery agent. Search for the most recently published earnings call transcripts for ${name} (${ticker}).

Today's date: ${dateCtx.today}
Search focus: ${dateCtx.currentQ} first, then ${dateCtx.prevQ} as fallback.

Run up to 3 searches using different queries:
  1. "${ticker} earnings call transcript ${dateCtx.currentQ} site:fool.com"
  2. "${name} earnings transcript ${dateCtx.searchYears} site:fool.com OR site:seekingalpha.com"
  3. "${ticker} Q earnings call transcript ${dateCtx.today.slice(0,4)}"

From all search results, extract a list of transcript candidates.

Output ONLY this JSON (no other text):
===CANDIDATES===
[
  { "url": "https://...", "title": "...", "date": "YYYY-MM-DD", "source": "fool.com" },
  { "url": "https://...", "title": "...", "date": "YYYY-MM-DD", "source": "seekingalpha.com" }
]
===END_CANDIDATES===

Rules:
- Include up to 5 candidates maximum
- Sort them newest date first
- Only include URLs that look like actual transcript pages (not news articles or summaries)
- If you cannot determine the exact date, estimate from the title (e.g. "Q1 2025" → "2025-04-01")
- If no transcripts found at all: output ===NO_CANDIDATES===`;

  const messages = [{ role: "user", content: `Find transcript candidates for ${name} (${ticker})` }];
  let iterations = 0;

  while (iterations < 8) {
    iterations++;
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: systemPrompt,
      tools: WEB_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: sanitizeAssistantContent(response.content) });

    if (response.stop_reason === "end_turn") {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

      if (text.includes("===CANDIDATES===")) {
        // Extract everything between the markers (end marker may be missing)
        const afterStart = text.split("===CANDIDATES===")[1] || "";
        const raw = (afterStart.includes("===END_CANDIDATES===")
          ? afterStart.split("===END_CANDIDATES===")[0]
          : afterStart
        ).trim();

        // Pull out just the JSON array — tolerant of extra text before/after
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            const candidates = JSON.parse(arrayMatch[0]);
            if (Array.isArray(candidates) && candidates.length > 0) return candidates;
          } catch {
            log(`  ⚠️  JSON parse failed on candidate list. Raw snippet: ${raw.slice(0, 200)}`);
          }
        } else {
          log(`  ⚠️  No JSON array found in candidate block. Raw snippet: ${raw.slice(0, 200)}`);
        }
        // Fall through to direct-search fallback below
      }

      if (text.includes("===NO_CANDIDATES===")) {
        log("  ⚠️  Model reports no candidates — trying direct search fallback.");
      }

      // ── Direct fallback: search DuckDuckGo ourselves without the model ─────
      log("  🔄 Direct fallback: searching for transcripts directly...");
      return await directTranscriptSearch(company, dateCtx, log);
    }

    if (response.stop_reason === "max_tokens") {
      log("  ⚠️  Discovery hit max_tokens — trying direct search fallback.");
      return await directTranscriptSearch(company, dateCtx, log);
    }

    if (response.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        try {
          const result = block.name === "web_search"
            ? await webSearch(block.input.query)
            : await fetchUrl(block.input.url);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: err.message });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  }

  return await directTranscriptSearch(company, dateCtx, log);
}

/**
 * Fallback: search DuckDuckGo directly (no model) and extract candidate URLs
 * using simple pattern matching on the HTML results.
 */
async function directTranscriptSearch(company, dateCtx, log) {
  const { name, ticker } = company;
  const queries = [
    `${ticker} earnings call transcript ${dateCtx.currentQ} site:fool.com`,
    `${ticker} Q earnings transcript ${dateCtx.today.slice(0, 4)} fool.com OR seekingalpha.com`,
  ];

  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    try {
      const { results } = await webSearch(query);
      for (const r of results) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);

        // Only keep URLs that look like transcript pages
        const isTranscript =
          (r.url.includes("fool.com") && r.url.includes("transcript")) ||
          (r.url.includes("seekingalpha.com") && (r.url.includes("transcript") || r.url.includes("earnings")));

        if (!isTranscript) continue;

        // Try to extract date from title (e.g. "Q3 2026" → approximate date)
        let date = null;
        const qMatch = r.title.match(/Q([1-4])\s*(FY)?(\d{4})/i);
        if (qMatch) {
          const q = parseInt(qMatch[1]);
          const yr = parseInt(qMatch[3]);
          const month = [4, 7, 10, 1][q - 1];
          const y = month === 1 ? yr + 1 : yr; // Q4 FY2025 reports in Jan 2026
          date = `${y}-${String(month).padStart(2, "0")}-15`;
        }

        const source = r.url.includes("fool.com") ? "fool.com" : "seekingalpha.com";
        candidates.push({ url: r.url, title: r.title, date, source });
        log(`  📎 Direct fallback found: [${date || "?"}] ${r.title.slice(0, 80)}`);
      }
    } catch (err) {
      log(`  ⚠️  Direct search failed: ${err.message}`);
    }
  }

  return candidates.sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
}

// ─── Phase 2: Direct HTTP Fetch (no model) ────────────────────────────────

/**
 * Fetches transcript text directly from a URL using Node.js HTTP.
 * Combines page 1 + page 2 for paginated transcripts (e.g. fool.com).
 * No AI agent involved — simple and reliable.
 */
async function fetchTranscriptDirect(candidate, log) {
  const { url, title, date, source } = candidate;

  log(`  🌐 Fetching: ${url}`);
  const page1 = await fetchUrl(url);
  let combined = page1.content;

  // Fetch page 2 if the source paginates transcripts
  if (source === "fool.com" || url.includes("fool.com")) {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const page2 = await fetchUrl(`${url}${sep}page=2`);
      if (page2.content.length > 500) {
        combined += "\n\n" + page2.content;
        log(`  🌐 Fetched page 2 (${page2.content.length.toLocaleString()} chars)`);
      }
    } catch (_) { /* page 2 optional */ }
  }

  if (combined.length < 500) throw new Error("Page content too short — likely blocked or paywalled.");

  log(`  ✅ Fetched ${combined.length.toLocaleString()} chars from ${source}`);
  return {
    transcript: combined,
    eventDate:  date || null,
    eventTitle: title,
    quarter:    null, // derived from title in checkCompany
  };
}

// ─── Agentic Transcript Fetcher (orchestrates both phases) ─────────────────

/**
 * Two-phase fetch:
 *   Phase 1 — discover candidate URLs with dates (agent does web searches)
 *   Phase 2 — client picks the newest valid candidate, agent fetches it
 *
 * Client-side guards:
 *   • Must be strictly newer than lastProcessedDate
 *   • Must be within the freshness window (≤ 120 days old)
 *   • Transcript body must be substantial (> 500 chars)
 *
 * @returns {{ transcript, eventDate, eventTitle, quarter } | null}
 */
async function fetchLatestTranscript(client, company, lastProcessedDate, log) {
  const { name, ticker } = company;
  const dateCtx = getDateContext();

  log(`  📅 Today: ${dateCtx.today} | Looking for: ${dateCtx.currentQ} or ${dateCtx.prevQ}`);

  // ── Phase 1: Discover ────────────────────────────────────────────────────
  log(`  🔎 Phase 1 — discovering transcript candidates...`);
  const candidates = await discoverCandidates(client, company, dateCtx, log);

  if (candidates.length === 0) {
    log(`  ⏭️  No transcript candidates found.`);
    return null;
  }

  log(`  📋 Found ${candidates.length} candidate(s):`);
  candidates.forEach((c, i) => log(`     ${i + 1}. [${c.date}] ${c.title} (${c.source})`));

  // ── Client-side selection: pick the newest valid candidate ───────────────
  const valid = candidates
    .filter((c) => {
      // Must have a parseable date
      if (!c.date) return false;

      // Must be newer than what we already processed
      if (lastProcessedDate && c.date <= lastProcessedDate) {
        log(`  ⏭️  [${c.date}] "${c.title}" — already processed (last: ${lastProcessedDate}), skipping.`);
        return false;
      }

      // Must be within the freshness window
      if (!isWithinFreshnessWindow(c.date, dateCtx.maxAgeDays)) {
        log(`  ⏭️  [${c.date}] "${c.title}" — too old (>${dateCtx.maxAgeDays} days), skipping.`);
        return false;
      }

      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first

  if (valid.length === 0) {
    log(`  ⏭️  No new transcripts after filtering — nothing to process.`);
    return null;
  }

  const selected = valid[0];
  log(`  ✅ Selected: [${selected.date}] "${selected.title}"`);

  // ── Phase 2: Direct HTTP fetch (no agent) ────────────────────────────────
  log(`  📥 Fetching transcript directly from ${selected.source}...`);

  let result;
  try {
    result = await fetchTranscriptDirect(selected, log);
  } catch (err) {
    // If first choice fails, try the next valid candidate
    if (valid.length > 1) {
      log(`  ⚠️  First choice failed (${err.message}), trying next candidate...`);
      result = await fetchTranscriptDirect(valid[1], log);
    } else {
      throw err;
    }
  }

  // ── Final client-side guards ─────────────────────────────────────────────

  // 1. Transcript must be substantial
  if (!result.transcript || result.transcript.length < 500) {
    throw new Error(`Transcript body too short (${result.transcript?.length ?? 0} chars) — likely not a real transcript.`);
  }

  // 2. Prefer the date from Phase 1 if the extracted date is missing/wrong
  if (!result.eventDate || result.eventDate === "YYYY-MM-DD") {
    result.eventDate = selected.date;
    log(`  ℹ️  Using date from discovery phase: ${result.eventDate}`);
  }

  // 3. Final freshness re-check on the extracted date
  if (!isWithinFreshnessWindow(result.eventDate, dateCtx.maxAgeDays)) {
    log(`  ⏭️  Extracted date ${result.eventDate} is outside the ${dateCtx.maxAgeDays}-day window — skipping.`);
    return null;
  }

  // 4. Final duplicate re-check on the extracted date
  if (lastProcessedDate && result.eventDate <= lastProcessedDate) {
    log(`  ⏭️  Extracted date ${result.eventDate} ≤ lastProcessedDate ${lastProcessedDate} — already have this one.`);
    return null;
  }

  log(`  ✅ Transcript verified: ${result.transcript.length.toLocaleString()} chars, dated ${result.eventDate}`);
  return result;
}

// ─── Summarizer ────────────────────────────────────────────────────────────

async function summarizeTranscript(client, transcript, skill, log) {
  log("  🧠 Summarizing with extended thinking (~30s)...");
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16_000,
    thinking: { type: "adaptive" },
    system:
      "You are an elite financial analyst. Produce an earnings call summary following the user's instructions exactly.",
    messages: [
      {
        role: "user",
        content: `## Summarization Instructions (from skill.md):\n\n${skill}\n\n---\n\n## Transcript:\n\n${transcript}`,
      },
    ],
  });
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ─── Main Checker Export ───────────────────────────────────────────────────

/**
 * Checks one company for a new earnings call. If a new one is found,
 * fetches the transcript, summarizes it, emails it, and returns the
 * updated company state. Returns null if nothing was processed.
 *
 * @param {object} company  - entry from watchlist.json
 * @param {Anthropic} client - initialized Anthropic client
 * @param {string} skill    - contents of skill.md
 * @param {Function} log    - (msg: string) => void logging function
 * @returns {object|null}   updated company entry, or null if skipped
 */
export async function checkCompany(company, client, skill, log) {
  log(`\n🔍 Checking ${company.name} (${company.ticker})...`);

  try {
    // Step 1 — Detect new transcript
    const latest = await fetchLatestTranscript(
      client,
      company,
      company.lastProcessedDate,
      log
    );

    if (!latest) return null; // Nothing new

    const { transcript, eventDate, eventTitle, quarter } = latest;
    log(`  ✅ New transcript: "${eventTitle}" (${eventDate})`);

    // Step 2 — Summarize
    const summary = await summarizeTranscript(client, transcript, skill, log);

    // Step 3 — Build full markdown output
    const generatedDate = new Date().toISOString().split("T")[0];
    const fullOutput = [
      `# Earnings Call Summary: ${company.name} (${company.ticker})`,
      `*${quarter} · ${eventDate} · Generated ${generatedDate} · claude-sonnet-4-6*`,
      ``,
      `---`,
      ``,
      summary,
      ``,
      `---`,
      `*Automated summary by earnings-summarizer.js*`,
    ].join("\n");

    // Step 4 — Save markdown to file
    const summariesDir = path.join(ROOT, "summaries");
    await fs.mkdir(summariesDir, { recursive: true });
    const baseName = `${company.ticker}_${eventDate || new Date().toISOString().split("T")[0]}`;
    const mdPath = path.join(summariesDir, `${baseName}_summary.md`);
    await fs.writeFile(mdPath, fullOutput, "utf-8");
    log(`  💾 Saved markdown → summaries/${baseName}_summary.md`);

    // Step 5 — Generate PDF
    let pdfPath = null;
    try {
      pdfPath = path.join(summariesDir, `${baseName}_summary.pdf`);
      await generatePdf({
        summaryMarkdown: summary,
        companyName: company.name,
        ticker: company.ticker,
        quarter,
        eventDate,
        outputPath: pdfPath,
      });
      log(`  📄 PDF generated → summaries/${baseName}_summary.pdf`);
    } catch (pdfErr) {
      log(`  ⚠️  PDF generation failed (email will still send): ${pdfErr.message}`);
      pdfPath = null;
    }

    // Step 6 — Email (optional — failure does NOT cancel the summary)
    try {
      log(`  📧 Sending email...`);
      const emailResult = await sendEarningsSummary({
        summaryMarkdown: summary,
        companyName: company.name,
        ticker: company.ticker,
        quarter,
        pdfPath,
      });
      log(`  ✉️  Delivered → ${emailResult.to}${pdfPath ? " (with PDF)" : ""}`);
    } catch (emailErr) {
      log(`  ⚠️  Email failed (summary still saved): ${emailErr.message}`);
    }

    // Return updated state — always, regardless of email outcome
    return {
      ...company,
      lastProcessedDate: eventDate,
      lastEventTitle: eventTitle,
    };
  } catch (err) {
    log(`  ❌ ${company.ticker} failed: ${err.message}`);
    return null;
  }
}
