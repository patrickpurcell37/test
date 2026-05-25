/**
 * earnings-summarizer.js
 *
 * Automated earnings call transcript summarizer powered by Claude AI.
 * Fetches the most recent earnings transcript for any company from public
 * sources (Motley Fool, etc.), then summarizes it using your custom skill
 * template (skill.md) with extended thinking for deep analysis.
 *
 * Usage:
 *   node earnings-summarizer.js --company "Apple"
 *   node earnings-summarizer.js --company "NVDA"
 *   node earnings-summarizer.js --company "Microsoft" --quarters 2
 *   node earnings-summarizer.js --file transcript.txt   (use a local transcript)
 *
 * Output: Saved to summaries/<Company>_<Date>.md  +  printed to console
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY in your environment or .env file
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ─────────────────────────────────────────────────────────

const CONFIG = {
  model: "claude-opus-4-7",
  thinkingBudget: 8000,
  maxTokens: 16000,
  skillFile: path.join(__dirname, "skill.md"),
  outputDir: path.join(__dirname, "summaries"),
};

// ─── Web Fetcher Tool Definitions ────────────────────────────────────────────
// Claude uses these tools in an agentic loop to find and fetch transcripts.

const WEB_TOOLS = [
  {
    name: "web_search",
    description:
      "Search the web for earnings call transcript URLs. Returns search result snippets and URLs.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Search query, e.g. "NVIDIA Q1 2025 earnings call transcript site:fool.com"',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch the HTML content of a URL. Use this to retrieve earnings transcript pages.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch (must start with https://)",
        },
      },
      required: ["url"],
    },
  },
];

// ─── Tool Implementations ─────────────────────────────────────────────────

async function webSearch(query) {
  // Use DuckDuckGo HTML endpoint for search results
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; EarningsSummarizer/1.0)",
      Accept: "text/html",
    },
  });

  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const html = await res.text();

  // Extract result links and snippets
  const results = [];
  const linkPattern = /class="result__url"[^>]*>([^<]+)<\/a>/g;
  const snippetPattern = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const urlPattern = /href="([^"]+)"/g;

  // Simpler extraction: find result blocks
  const blocks = html.split('class="result ').slice(1, 11);
  for (const block of blocks) {
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

    if (titleMatch) {
      let resultUrl = titleMatch[1];
      // DuckDuckGo wraps URLs — decode if needed
      if (resultUrl.includes("uddg=")) {
        const uddg = new URL("https://example.com" + resultUrl).searchParams.get("uddg");
        if (uddg) resultUrl = decodeURIComponent(uddg);
      }
      results.push({
        url: resultUrl,
        title: titleMatch[2],
        snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, " ").trim() : "",
      });
    }
  }

  // Also try Motley Fool search directly
  const foolSearch = await fetch(
    `https://www.fool.com/search/#q=${encoded}&filter=transcript`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EarningsSummarizer/1.0)",
        Accept: "text/html",
      },
    }
  ).catch(() => null);

  return { results: results.slice(0, 8), query };
}

async function fetchUrl(url) {
  if (!url.startsWith("https://")) {
    throw new Error("Only HTTPS URLs are supported");
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    redirect: "follow",
  });

  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

  const html = await res.text();

  // Strip down HTML to readable text
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, "\n\n")
    .trim();

  // Return first 60,000 chars to stay within context limits
  return { url, content: text.slice(0, 60000), length: text.length };
}

// ─── Argument Parsing ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { company: null, quarters: 1, file: null, outputFile: null, quiet: false };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--company":  args.company = argv[++i]; break;
      case "--quarters": args.quarters = parseInt(argv[++i]) || 1; break;
      case "--file":     args.file = argv[++i]; break;
      case "--output":   args.outputFile = argv[++i]; break;
      case "--quiet":    args.quiet = true; break;
      case "--help":
        console.log(`
Usage: node earnings-summarizer.js [options]

Options:
  --company <name>    Company name or ticker (e.g., "Apple", "NVDA", "Tesla")
  --quarters <n>      Number of recent quarters to summarize (default: 1)
  --file <path>       Use a local transcript file instead of fetching
  --output <path>     Save summary to a specific file
  --quiet             Suppress console output (only save to file)
  --help              Show this help

Examples:
  node earnings-summarizer.js --company "Apple"
  node earnings-summarizer.js --company "NVDA" --quarters 2
  node earnings-summarizer.js --file my-transcript.txt

Customize the analysis by editing: skill.md
        `);
        process.exit(0);
    }
  }

  if (!args.company && !args.file) {
    console.error("❌ Error: Provide --company <name> or --file <transcript.txt>");
    console.error("   Run with --help for usage information.");
    process.exit(1);
  }

  return args;
}

// ─── Skill Loader ─────────────────────────────────────────────────────────

async function loadSkill() {
  try {
    return await fs.readFile(CONFIG.skillFile, "utf-8");
  } catch {
    console.warn("⚠️  skill.md not found — using default summarization prompt.");
    return `Summarize this earnings call transcript. Extract:
1. Key financial metrics (revenue, EPS, margins, guidance)
2. Management narrative and tone
3. Major themes, risks, and catalysts
4. Notable Q&A moments
Be precise with numbers, insightful about management tone, and direct about investment implications.`;
  }
}

// ─── Output Manager ───────────────────────────────────────────────────────

async function saveOutput(content, companyName, outputFile) {
  await fs.mkdir(CONFIG.outputDir, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  const safeName = companyName.replace(/[^a-zA-Z0-9]/g, "_");
  const filename = outputFile || path.join(CONFIG.outputDir, `${safeName}_${date}.md`);
  await fs.writeFile(filename, content, "utf-8");
  return filename;
}

// ─── Agentic Transcript Fetcher ───────────────────────────────────────────

/**
 * Uses Claude in an agentic tool-use loop to:
 * 1. Search for the company's most recent earnings transcript
 * 2. Identify the best URL (Motley Fool, Seeking Alpha, etc.)
 * 3. Fetch and extract the full transcript text
 */
async function fetchTranscriptAgentically(client, companyQuery, quiet) {
  if (!quiet) console.log(`\n🔍 Fetching transcript for "${companyQuery}"...`);

  const systemPrompt = `You are a financial data retrieval agent. Your ONLY job is to find and retrieve the full text of the most recent earnings call transcript for the requested company.

Steps:
1. Search for: "<company> most recent earnings call transcript site:fool.com OR site:seekingalpha.com"
2. Identify the most recent transcript URL from the results
3. Fetch that URL to get the transcript text
4. If the page doesn't have the transcript, try other URLs from the search results
5. When you have the complete transcript text, output it EXACTLY as:

===TRANSCRIPT_START===
<Company Name> | <Quarter and Year, e.g. Q1 2025> | <Event Date>
<full transcript text here>
===TRANSCRIPT_END===

Critical rules:
- Include ALL speaker turns, analyst questions, and management responses
- Do NOT summarize or truncate the transcript
- Do NOT add commentary — just the raw transcript text
- If you can't find the transcript, explain why and output: ===TRANSCRIPT_NOT_FOUND===`;

  const messages = [
    {
      role: "user",
      content: `Find and retrieve the most recent earnings call transcript for: ${companyQuery}`,
    },
  ];

  let transcript = null;
  let iterations = 0;
  const MAX_ITERATIONS = 12;

  while (!transcript && iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: CONFIG.model,
      max_tokens: 8000,
      system: systemPrompt,
      tools: WEB_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    // Check completion
    if (response.stop_reason === "end_turn") {
      const textBlocks = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      if (textBlocks.includes("===TRANSCRIPT_START===")) {
        transcript = textBlocks
          .split("===TRANSCRIPT_START===")[1]
          .split("===TRANSCRIPT_END===")[0]
          .trim();
      } else if (textBlocks.includes("===TRANSCRIPT_NOT_FOUND===")) {
        throw new Error(
          `Could not find transcript for "${companyQuery}". ` +
          `Try providing one with --file <transcript.txt>.`
        );
      } else {
        throw new Error("Agent completed without returning a transcript.");
      }
      break;
    }

    // Execute tool calls
    if (response.stop_reason === "tool_use") {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        const { id, name, input } = block;
        if (!quiet) {
          console.log(
            `  🔧 ${name}(${JSON.stringify(input).slice(0, 100)}${JSON.stringify(input).length > 100 ? "..." : ""})`
          );
        }

        try {
          let result;
          if (name === "web_search") {
            result = await webSearch(input.query);
          } else if (name === "fetch_url") {
            result = await fetchUrl(input.url);
            if (!quiet) console.log(`  ✅ Fetched ${result.length.toLocaleString()} chars from ${input.url}`);
          } else {
            result = { error: `Unknown tool: ${name}` };
          }

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

  if (!transcript) {
    throw new Error(`Failed to retrieve transcript after ${MAX_ITERATIONS} attempts.`);
  }

  return transcript;
}

// ─── Summarizer ───────────────────────────────────────────────────────────

/**
 * Uses Claude with extended thinking to produce a deep, structured summary
 * guided by the user's skill.md template.
 */
async function summarizeTranscript(client, transcript, skill, companyName, quiet) {
  if (!quiet) console.log(`\n🧠 Analyzing with extended thinking (this takes ~30s)...`);

  const response = await client.messages.create({
    model: CONFIG.model,
    max_tokens: CONFIG.maxTokens,
    thinking: {
      type: "enabled",
      budget_tokens: CONFIG.thinkingBudget,
    },
    system: `You are an elite financial analyst specializing in earnings call analysis.
You produce exceptionally insightful summaries that help investors make informed decisions.
Follow the formatting instructions in the user's skill template precisely.`,
    messages: [
      {
        role: "user",
        content: `## Your Summarization Instructions (from skill.md):

${skill}

---

## Earnings Call Transcript to Analyze:

${transcript}

---

Now produce the summary exactly as instructed above. Be precise with numbers, insightful about management tone, and direct about investment implications.`,
      },
    ],
  });

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ─── Main Exported Runner ─────────────────────────────────────────────────

export async function run(companyQuery, options = {}) {
  const {
    file = null,
    outputFile = null,
    quiet = false,
    quarters = 1,
  } = options;

  // Load API credentials — supports both API key and Bearer (OAuth) token
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey && !authToken) {
    throw new Error(
      "Authentication required. Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in your environment or .env file.\n" +
      "Get an API key at: https://console.anthropic.com"
    );
  }

  const clientOptions = apiKey
    ? { apiKey }
    : { authToken, defaultHeaders: { "anthropic-version": "2023-06-01" } };

  const client = new Anthropic(clientOptions);

  // Load skill template
  const skill = await loadSkill();
  if (!quiet) console.log("📄 Loaded skill template from skill.md");

  // Get transcript
  let transcript;
  let displayName = companyQuery || "Company";

  if (file) {
    if (!quiet) console.log(`📂 Loading transcript from ${file}...`);
    transcript = await fs.readFile(file, "utf-8");
    displayName = path.basename(file, path.extname(file));
  } else {
    transcript = await fetchTranscriptAgentically(client, companyQuery, quiet);
    displayName = companyQuery;
  }

  if (!transcript || transcript.length < 100) {
    throw new Error("Retrieved transcript appears empty or too short.");
  }

  if (!quiet) {
    console.log(`\n📝 Transcript loaded: ${transcript.length.toLocaleString()} chars`);
  }

  // Summarize
  const summary = await summarizeTranscript(client, transcript, skill, displayName, quiet);

  // Build final output
  const date = new Date().toISOString().split("T")[0];
  const output = [
    `# Earnings Call Summary: ${displayName}`,
    `*Generated ${date} · Model: ${CONFIG.model} · Template: skill.md*`,
    ``,
    `---`,
    ``,
    summary,
    ``,
    `---`,
    `*Automated summary by earnings-summarizer.js*`,
  ].join("\n");

  // Print to console
  if (!quiet) {
    console.log("\n" + "═".repeat(70));
    console.log(output);
    console.log("═".repeat(70));
  }

  // Save to file
  const savedPath = await saveOutput(output, displayName, outputFile);
  if (!quiet) console.log(`\n✅ Summary saved → ${savedPath}`);

  return { summary: output, savedPath };
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Load .env if present
  try {
    const envFile = await fs.readFile(path.join(__dirname, ".env"), "utf-8");
    for (const line of envFile.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env file — that's fine
  }

  const args = parseArgs(process.argv);

  run(args.company, {
    file: args.file,
    outputFile: args.outputFile,
    quiet: args.quiet,
    quarters: args.quarters,
  }).catch((err) => {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  });
}
