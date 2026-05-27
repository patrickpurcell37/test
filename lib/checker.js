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
      model: "claude-opus-4-7",
      max_tokens: 2000,
      system: systemPrompt,
      tools: WEB_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: sanitizeAssistantContent(response.content) });

    if (response.stop_reason === "end_turn") {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

      if (text.includes("===CANDIDATES===")) {
        try {
          const raw = text.split("===CANDIDATES===")[1].split("===END_CANDIDATES===")[0].trim();
          const candidates = JSON.parse(raw);
          return Array.isArray(candidates) ? candidates : [];
        } catch {
          log("  ⚠️  Could not parse candidate list — falling back to single-phase fetch.");
          return [];
        }
      }

      if (text.includes("===NO_CANDIDATES===")) return [];
      return [];
    }

    if (response.stop_reason === "max_tokens") {
      log("  ⚠️  Discovery hit max_tokens — returning partial results.");
      return [];
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

  return [];
}

// ─── Phase 2: Fetch Selected Transcript ───────────────────────────────────

/**
 * Fetches the full transcript from a specific URL.
 * Returns { transcript, eventDate, eventTitle, quarter } or throws.
 */
async function fetchTranscriptFromUrl(client, url, companyName, ticker, log) {
  const systemPrompt = `You are a transcript extraction agent. Fetch this URL and extract the complete earnings call transcript.

URL: ${url}

After fetching, output ONLY:
===TRANSCRIPT_START===
EventDate: YYYY-MM-DD
Quarter: Q? FY????
Title: <full event title>
<complete transcript text — every speaker turn, do not skip or summarize any section>
===TRANSCRIPT_END===

If the page does not contain a transcript, output:
===NOT_A_TRANSCRIPT===
Reason: <why>`;

  const messages = [{ role: "user", content: `Fetch and extract the transcript from: ${url}` }];
  let iterations = 0;

  while (iterations < 6) {
    iterations++;
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8000,
      system: systemPrompt,
      tools: WEB_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: sanitizeAssistantContent(response.content) });

    if (response.stop_reason === "end_turn") {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

      if (text.includes("===TRANSCRIPT_START===")) {
        const inner = text.split("===TRANSCRIPT_START===")[1].split("===TRANSCRIPT_END===")[0].trim();
        const lines = inner.split("\n");
        const getHeader = (prefix) => (lines.find((l) => l.startsWith(prefix)) || "").replace(prefix, "").trim();

        return {
          transcript: lines.slice(3).join("\n").trim(),
          eventDate: getHeader("EventDate:"),
          eventTitle: getHeader("Title:"),
          quarter: getHeader("Quarter:"),
        };
      }

      throw new Error("Page did not contain a transcript.");
    }

    if (response.stop_reason === "max_tokens") {
      // Response was cut off — the fetched page is too large to process in one shot.
      // Throw so the caller can try the next candidate.
      throw new Error("Response hit max_tokens — page content too large to extract transcript.");
    }

    if (response.stop_reason === "tool_use") {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        log(`  🔧 ${block.name}(${block.input.url || block.input.query || ""})`);
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

  throw new Error("Could not fetch transcript after max iterations.");
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

  // ── Phase 2: Fetch the selected transcript ───────────────────────────────
  log(`  🔧 Phase 2 — fetching full transcript from ${selected.source}...`);

  let result;
  try {
    result = await fetchTranscriptFromUrl(client, selected.url, name, ticker, log);
  } catch (err) {
    // If first choice fails, try the next valid candidate
    if (valid.length > 1) {
      log(`  ⚠️  First choice failed (${err.message}), trying next candidate...`);
      result = await fetchTranscriptFromUrl(client, valid[1].url, name, ticker, log);
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
    model: "claude-opus-4-7",
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
      `*${quarter} · ${eventDate} · Generated ${generatedDate} · claude-opus-4-7*`,
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
