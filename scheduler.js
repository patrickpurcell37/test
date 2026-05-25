/**
 * scheduler.js
 *
 * Earnings Alert Scheduler
 * ─────────────────────────
 * Loads watchlist.json, checks each enabled company for a new earnings call,
 * and if found: fetches the transcript → summarizes → emails → updates state.
 *
 * Designed to be run:
 *   • By GitHub Actions on a cron schedule (recommended)
 *   • Manually: node scheduler.js
 *   • Locally with node-cron: node scheduler.js --daemon
 *
 * Required environment variables (set in .env or GitHub Secrets):
 *   ANTHROPIC_API_KEY     Your Anthropic API key
 *   GMAIL_USER            Your Gmail address
 *   GMAIL_APP_PASSWORD    16-character Gmail App Password
 *   TO_EMAIL              Destination email (can equal GMAIL_USER)
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { checkCompany } from "./lib/checker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WATCHLIST_PATH = path.join(__dirname, "watchlist.json");
const SKILL_PATH = path.join(__dirname, "skill.md");

// ─── Logging ────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// ─── Env Loader ─────────────────────────────────────────────────────────────

async function loadEnv() {
  try {
    const envFile = await fs.readFile(path.join(__dirname, ".env"), "utf-8");
    for (const line of envFile.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env file — rely on environment variables
  }
}

// ─── Watchlist I/O ───────────────────────────────────────────────────────────

async function loadWatchlist() {
  const raw = await fs.readFile(WATCHLIST_PATH, "utf-8");
  return JSON.parse(raw);
}

async function saveWatchlist(data) {
  await fs.writeFile(WATCHLIST_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ─── Main Run ────────────────────────────────────────────────────────────────

async function runChecks() {
  log("═══════════════════════════════════════════════");
  log("  Earnings Alert Scheduler — starting run");
  log("═══════════════════════════════════════════════");

  await loadEnv();

  // Validate credentials
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN; // Claude Code session fallback
  if (!apiKey && !authToken) {
    log("❌ ANTHROPIC_API_KEY not set. Add it to .env or environment.");
    process.exit(1);
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    log("❌ Gmail credentials not set. Add GMAIL_USER and GMAIL_APP_PASSWORD.");
    process.exit(1);
  }

  // Initialize Anthropic client
  const client = new Anthropic(
    apiKey ? { apiKey } : { authToken }
  );

  // Load watchlist and skill template
  const watchlist = await loadWatchlist();
  let skill;
  try {
    skill = await fs.readFile(SKILL_PATH, "utf-8");
    log(`📄 Loaded skill template (${skill.length} chars)`);
  } catch {
    log("⚠️  skill.md not found — using default summarization prompt.");
    skill = "Summarize the earnings call. Extract: financial metrics, management narrative, risks, guidance, and Q&A highlights. Be precise and direct.";
  }

  const companies = watchlist.companies.filter((c) => c.enabled !== false);
  log(`📋 Watchlist: ${companies.length} company/ies → ${companies.map((c) => c.ticker).join(", ")}`);

  // Check each company
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const company of companies) {
    const updated = await checkCompany(company, client, skill, log);

    if (updated) {
      // Update the watchlist entry with new state
      const idx = watchlist.companies.findIndex((c) => c.ticker === company.ticker);
      if (idx !== -1) watchlist.companies[idx] = updated;
      processed++;
    } else {
      skipped++;
    }
  }

  // Save updated watchlist (persists lastProcessedDate for next run)
  await saveWatchlist(watchlist);

  log("\n═══════════════════════════════════════════════");
  log(`  Run complete: ${processed} new summaries sent, ${skipped} skipped`);
  log("═══════════════════════════════════════════════");
}

// ─── Daemon Mode (local cron) ────────────────────────────────────────────────

async function startDaemon() {
  // Dynamic import so nodemailer is the only hard dep for the cron case
  let cron;
  try {
    cron = await import("node-cron");
  } catch {
    log("❌ node-cron not installed. Run: npm install node-cron");
    process.exit(1);
  }

  // Default: every weekday at 9 AM local time
  const schedule = process.env.CRON_SCHEDULE || "0 9 * * 1-5";
  log(`🕘 Daemon mode — schedule: "${schedule}"`);
  log("   Press Ctrl+C to stop.\n");

  // Run immediately on start
  await runChecks();

  // Then on schedule
  cron.default.schedule(schedule, () => {
    runChecks().catch((err) => log(`❌ Scheduled run failed: ${err.message}`));
  });
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

const isDaemon = process.argv.includes("--daemon");

if (isDaemon) {
  startDaemon().catch((err) => {
    log(`❌ Fatal: ${err.message}`);
    process.exit(1);
  });
} else {
  // Single run (GitHub Actions mode)
  runChecks().catch((err) => {
    log(`❌ Fatal: ${err.message}`);
    process.exit(1);
  });
}
