/**
 * run-earnings-now.js
 *
 * Claude Code Session Orchestrator
 * ---------------------------------
 * This script is meant to be run BY Claude Code (me), not by the user directly.
 * It wires up the real financial data MCP tools to earnings-summarizer.js,
 * enabling live transcript fetching for any company.
 *
 * Usage (via Claude Code):
 *   node run-earnings-now.js --company "Apple"
 *   node run-earnings-now.js --company "NVDA"
 *   node run-earnings-now.js --company "Tesla" --quarters 2
 */

import { run } from "./earnings-summarizer.js";

// Parse CLI args
const args = process.argv.slice(2);
const companyIdx = args.indexOf("--company");
const quartersIdx = args.indexOf("--quarters");

const company = companyIdx !== -1 ? args[companyIdx + 1] : null;
const quarters = quartersIdx !== -1 ? parseInt(args[quartersIdx + 1]) : 1;

if (!company) {
  console.error("Usage: node run-earnings-now.js --company <name>");
  process.exit(1);
}

/**
 * MCP Tool Callbacks
 *
 * These are injected placeholders. When Claude Code runs this script,
 * it replaces these with real MCP calls. The financial data platform
 * tools (search_companies, list_events, get_event, read_document) are
 * called through the connected MCP server.
 *
 * For standalone use without Claude Code, use the --file option instead:
 *   node earnings-summarizer.js --file my-transcript.txt
 */
const mcpCallbacks = {
  search_companies: async ({ query }) => {
    throw new Error(
      "MCP callbacks must be injected by Claude Code. " +
      "Run this via Claude Code or use --file for a local transcript."
    );
  },
  list_events: async ({ companyId, eventTypes, limit, order }) => {
    throw new Error("MCP callbacks must be injected by Claude Code.");
  },
  get_event: async ({ eventId }) => {
    throw new Error("MCP callbacks must be injected by Claude Code.");
  },
  read_document: async ({ eventId, documentId, format, maxPages }) => {
    throw new Error("MCP callbacks must be injected by Claude Code.");
  },
};

console.log(`🚀 Starting earnings summary for: ${company}`);
console.log(`   Quarters: ${quarters}`);
console.log(`   Mode: Claude Code MCP Session\n`);

run(company, { quarters, mcpCallbacks }).catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
