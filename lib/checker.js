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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

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
  return { url, content: text.slice(0, 60_000), length: text.length };
}

// ─── Agentic Transcript Fetcher ────────────────────────────────────────────

/**
 * Uses Claude in a tool-use loop to find and return the latest earnings
 * call transcript. Returns null if no new transcript is found (i.e., the
 * most recent one was already processed).
 *
 * @returns {{ transcript, eventDate, eventTitle, quarter } | null}
 */
async function fetchLatestTranscript(client, company, lastProcessedDate, log) {
  const { name, ticker } = company;
  const cutoffNote = lastProcessedDate
    ? ` Only return a transcript if its event date is strictly after ${lastProcessedDate}.`
    : "";

  const systemPrompt = `You are a financial data retrieval agent. Find the most recent earnings call transcript for ${name} (${ticker}).

Steps:
1. Search: "${ticker} ${name} earnings call transcript 2025 site:fool.com"
2. Pick the most recently published transcript URL from the results
3. Fetch that URL to retrieve the full transcript text
4. Extract the event date from the page title or transcript header

Required output format — choose exactly one:

Option A (new transcript found):
===TRANSCRIPT_START===
EventDate: YYYY-MM-DD
Quarter: Q? FY????
Title: <full event title>
<complete transcript text — include every speaker turn, do not truncate>
===TRANSCRIPT_END===

Option B (no new transcript):
===NO_NEW_TRANSCRIPT===
Reason: <brief explanation>${cutoffNote}`;

  const messages = [
    {
      role: "user",
      content:
        `Retrieve the latest earnings call transcript for ${name} (${ticker}).` + cutoffNote,
    },
  ];

  let iterations = 0;
  const MAX = 12;

  while (iterations < MAX) {
    iterations++;
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8000,
      system: systemPrompt,
      tools: WEB_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    // Agent finished — parse output
    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      if (text.includes("===TRANSCRIPT_START===")) {
        const inner = text
          .split("===TRANSCRIPT_START===")[1]
          .split("===TRANSCRIPT_END===")[0]
          .trim();

        const lines = inner.split("\n");
        const getHeader = (prefix) =>
          (lines.find((l) => l.startsWith(prefix)) || "")
            .replace(prefix, "")
            .trim();

        const eventDate = getHeader("EventDate:");
        const quarter = getHeader("Quarter:");
        const eventTitle = getHeader("Title:");
        // Transcript body starts after the 3 header lines
        const transcript = lines.slice(3).join("\n").trim();

        // Skip if already processed
        if (lastProcessedDate && eventDate && eventDate <= lastProcessedDate) {
          log(`  ⏭️  Most recent event (${eventDate}) already processed — skipping.`);
          return null;
        }

        return { transcript, eventDate, eventTitle, quarter };
      }

      if (text.includes("===NO_NEW_TRANSCRIPT===")) {
        log(`  ⏭️  No new transcript found.`);
        return null;
      }

      throw new Error("Agent finished without returning a recognized output block.");
    }

    // Process tool calls
    if (response.stop_reason === "tool_use") {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const { id, name: toolName, input } = block;
        log(`  🔧 ${toolName}(${JSON.stringify(input).slice(0, 80)})`);

        try {
          const result =
            toolName === "web_search"
              ? await webSearch(input.query)
              : await fetchUrl(input.url);
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            is_error: true,
            content: err.message,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  throw new Error(`Exceeded ${MAX} iterations without a result.`);
}

// ─── Summarizer ────────────────────────────────────────────────────────────

async function summarizeTranscript(client, transcript, skill, log) {
  log("  🧠 Summarizing with extended thinking (~30s)...");
  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 16_000,
    thinking: { type: "enabled", budget_tokens: 8000 },
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

    // Step 4 — Save to file
    const summariesDir = path.join(ROOT, "summaries");
    await fs.mkdir(summariesDir, { recursive: true });
    const filename = `${company.ticker}_${eventDate}_summary.md`;
    const filePath = path.join(summariesDir, filename);
    await fs.writeFile(filePath, fullOutput, "utf-8");
    log(`  💾 Saved → summaries/${filename}`);

    // Step 5 — Email
    log(`  📧 Sending email...`);
    const emailResult = await sendEarningsSummary({
      summaryMarkdown: fullOutput,
      companyName: company.name,
      ticker: company.ticker,
      quarter,
    });
    log(`  ✉️  Delivered → ${emailResult.to}`);

    // Step 6 — Return updated state for watchlist
    return {
      ...company,
      lastProcessedDate: eventDate,
      lastEventTitle: eventTitle,
    };
  } catch (err) {
    log(`  ❌ ${company.ticker} failed: ${err.message}`);
    return null; // Don't update state on failure
  }
}
