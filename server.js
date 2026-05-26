/**
 * server.js — Earnings Intelligence Web App
 *
 * Express server that powers the Quartr-like earnings dashboard.
 * Serves the SPA from public/ and exposes a REST API for:
 *   - Watchlist CRUD
 *   - Summary listing / reading
 *   - Upcoming earnings calendar (Yahoo Finance)
 *   - Company search (Yahoo Finance)
 *   - Live earnings run trigger (SSE log stream)
 *
 * Usage:
 *   node server.js            → http://localhost:3000
 *   PORT=8080 node server.js  → http://localhost:8080
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import { existsSync, createReadStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Paths ────────────────────────────────────────────────────────────────────
const WATCHLIST_PATH = path.join(__dirname, "watchlist.json");
const SUMMARIES_DIR  = path.join(__dirname, "summaries");
const PUBLIC_DIR     = path.join(__dirname, "public");

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ── Watchlist helpers ─────────────────────────────────────────────────────────
async function readWatchlist() {
  const raw = await fs.readFile(WATCHLIST_PATH, "utf-8");
  return JSON.parse(raw);
}

async function saveWatchlist(wl) {
  await fs.writeFile(WATCHLIST_PATH, JSON.stringify(wl, null, 2), "utf-8");
}

// ── GET /api/watchlist ────────────────────────────────────────────────────────
app.get("/api/watchlist", async (req, res) => {
  try {
    const wl = await readWatchlist();
    res.json(wl.companies);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/watchlist — add a company ────────────────────────────────────────
app.post("/api/watchlist", async (req, res) => {
  try {
    const { name, ticker } = req.body;
    if (!name || !ticker) return res.status(400).json({ error: "name and ticker required" });

    const wl = await readWatchlist();
    const tic = ticker.toUpperCase();

    if (wl.companies.find((c) => c.ticker === tic)) {
      return res.status(409).json({ error: `${tic} is already in your watchlist` });
    }

    wl.companies.push({
      name,
      ticker: tic,
      lastProcessedDate: null,
      lastEventTitle: null,
      enabled: true,
    });

    await saveWatchlist(wl);
    res.json({ ok: true, company: wl.companies[wl.companies.length - 1] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/watchlist/:ticker — update a company ────────────────────────────
app.patch("/api/watchlist/:ticker", async (req, res) => {
  try {
    const tic = req.params.ticker.toUpperCase();
    const wl = await readWatchlist();
    const idx = wl.companies.findIndex((c) => c.ticker === tic);
    if (idx === -1) return res.status(404).json({ error: "Company not found" });

    wl.companies[idx] = { ...wl.companies[idx], ...req.body, ticker: tic };
    await saveWatchlist(wl);
    res.json({ ok: true, company: wl.companies[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/watchlist/:ticker ─────────────────────────────────────────────
app.delete("/api/watchlist/:ticker", async (req, res) => {
  try {
    const tic = req.params.ticker.toUpperCase();
    const wl = await readWatchlist();
    const before = wl.companies.length;
    wl.companies = wl.companies.filter((c) => c.ticker !== tic);
    if (wl.companies.length === before) return res.status(404).json({ error: "Company not found" });
    await saveWatchlist(wl);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/summaries — list available summary files ──────────────────────────
app.get("/api/summaries", async (req, res) => {
  try {
    await fs.mkdir(SUMMARIES_DIR, { recursive: true });
    const files = await fs.readdir(SUMMARIES_DIR);

    const summaries = [];
    for (const f of files.filter((f) => f.endsWith("_summary.md"))) {
      // Filename pattern: TICKER_DATE_summary.md  or  TICKER_Q?_FY????_summary.md
      const base = f.replace("_summary.md", "");
      const parts = base.split("_");
      const ticker = parts[0];

      try {
        const stat = await fs.stat(path.join(SUMMARIES_DIR, f));
        summaries.push({
          file: f,
          ticker,
          base,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      } catch (_) {}
    }

    summaries.sort((a, b) => b.modified.localeCompare(a.modified));
    res.json(summaries);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/summaries/:file — get summary markdown content ───────────────────
app.get("/api/summaries/:file", async (req, res) => {
  try {
    const file = req.params.file;
    // Security: only allow _summary.md files, no path traversal
    if (!file.endsWith("_summary.md") || file.includes("..") || file.includes("/")) {
      return res.status(400).json({ error: "Invalid file name" });
    }
    const filePath = path.join(SUMMARIES_DIR, file);
    const content = await fs.readFile(filePath, "utf-8");
    res.type("text/plain").send(content);
  } catch (e) {
    res.status(404).json({ error: "Summary not found" });
  }
});

// ── GET /api/summaries/:file/pdf — download PDF ──────────────────────────────
app.get("/api/summaries/:file/pdf", async (req, res) => {
  try {
    const base = req.params.file.replace("_summary.md", "");
    if (base.includes("..") || base.includes("/")) return res.status(400).send("Invalid");
    const pdfPath = path.join(SUMMARIES_DIR, `${base}_summary.pdf`);
    if (!existsSync(pdfPath)) return res.status(404).json({ error: "PDF not found" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${base}_summary.pdf"`);
    createReadStream(pdfPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/run/:ticker — trigger earnings check (SSE log stream) ───────────
app.post("/api/run/:ticker", (req, res) => {
  const ticker = req.params.ticker.toUpperCase();

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (msg) => res.write(`data: ${JSON.stringify({ log: msg })}\n\n`);

  send(`🚀 Starting earnings check for ${ticker}...`);

  // Modify watchlist to force-run only this ticker
  readWatchlist().then(async (wl) => {
    // Backup + create a temp watchlist with only this ticker enabled and date cleared
    const tempWl = {
      ...wl,
      companies: wl.companies.map((c) => ({
        ...c,
        enabled: c.ticker === ticker,
        lastProcessedDate: c.ticker === ticker ? null : c.lastProcessedDate,
      })),
    };

    // If ticker not in watchlist, error out
    if (!tempWl.companies.find((c) => c.ticker === ticker)) {
      send(`❌ ${ticker} is not in your watchlist. Add it first.`);
      res.write(`data: ${JSON.stringify({ done: true, error: true })}\n\n`);
      res.end();
      return;
    }

    const tempPath = path.join(__dirname, ".watchlist_run_tmp.json");
    await fs.writeFile(tempPath, JSON.stringify(tempWl, null, 2));

    const child = spawn(
      process.execPath,
      ["scheduler.js", "--watchlist", tempPath],
      {
        cwd: __dirname,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    child.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      lines.forEach((line) => send(line));
    });

    child.stderr.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      lines.forEach((line) => send(`⚠️  ${line}`));
    });

    child.on("close", async (code) => {
      // Clean up temp file
      await fs.unlink(tempPath).catch(() => {});
      if (code === 0) {
        send(`✅ Run complete for ${ticker}`);
        res.write(`data: ${JSON.stringify({ done: true, success: true })}\n\n`);
      } else {
        send(`❌ Run exited with code ${code}`);
        res.write(`data: ${JSON.stringify({ done: true, error: true })}\n\n`);
      }
      res.end();
    });
  }).catch((e) => {
    send(`❌ ${e.message}`);
    res.write(`data: ${JSON.stringify({ done: true, error: true })}\n\n`);
    res.end();
  });
});

// ── GET /api/search?q= — search Yahoo Finance for company info ────────────────
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=en-US&region=US&quotesCount=6&enableNavLinks=false`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EarningsDashboard/1.0)",
        Accept: "application/json",
      },
    });

    if (!resp.ok) throw new Error(`Yahoo Finance returned ${resp.status}`);
    const data = await resp.json();

    const quotes = (data.quotes || [])
      .filter((q) => q.quoteType === "EQUITY" && q.symbol && q.shortname)
      .slice(0, 6)
      .map((q) => ({
        ticker: q.symbol,
        name: q.longname || q.shortname,
        exchange: q.exchange,
        type: q.quoteType,
      }));

    res.json(quotes);
  } catch (e) {
    // Fallback: return the raw query as a ticker suggestion so adding still works
    const tic = q.toUpperCase().replace(/[^A-Z0-9\-\.]/g, "");
    if (tic) res.json([{ ticker: tic, name: tic, exchange: "—" }]);
    else res.json([]);
  }
});

// ── GET /api/calendar — upcoming earnings dates ────────────────────────────────
app.get("/api/calendar", async (req, res) => {
  try {
    const wl = await readWatchlist();
    const tickers = wl.companies.filter((c) => c.enabled).map((c) => c.ticker);

    // Fetch upcoming earnings from Yahoo Finance for each ticker
    const results = await Promise.allSettled(
      tickers.map((ticker) => fetchUpcomingEarnings(ticker))
    );

    const calendar = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) {
        calendar.push({ ticker: tickers[i], ...r.value });
      }
    });

    // Sort by date
    calendar.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    res.json(calendar);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function fetchUpcomingEarnings(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=calendarEvents,earnings`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EarningsDashboard/1.0)",
        Accept: "application/json",
      },
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return null;

    // Earnings date from calendarEvents
    const earningsDates = result.calendarEvents?.earnings?.earningsDate;
    let date = null;
    if (earningsDates && earningsDates.length > 0) {
      date = new Date(earningsDates[0].raw * 1000).toISOString().split("T")[0];
    }

    // Historical EPS from earnings module
    const epsHistory = result.earnings?.earningsHistory?.history || [];
    const lastEps = epsHistory[epsHistory.length - 1];

    return {
      date,
      epsEstimate: result.calendarEvents?.earnings?.epsAverage?.fmt || null,
      lastActualEps: lastEps?.epsActual?.fmt || null,
      lastEpsSurprise: lastEps?.surprisePercent?.fmt || null,
      lastEpsSurpriseRaw: lastEps?.surprisePercent?.raw || null,
    };
  } catch {
    return null;
  }
}

// ── GET /api/quote/:ticker — get current price quote ──────────────────────────
app.get("/api/quote/:ticker", async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    // Try Yahoo Finance chart API with browser-like headers
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json,text/html,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com/",
        "Origin": "https://finance.yahoo.com",
      },
    });
    if (!resp.ok) throw new Error(`${resp.status}`);
    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("No data");

    const prev = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
    res.json({
      ticker,
      price: meta.regularMarketPrice,
      prevClose: prev,
      change: meta.regularMarketPrice - prev,
      changePct: ((meta.regularMarketPrice - prev) / prev) * 100,
      currency: meta.currency || "USD",
      marketCap: meta.marketCap || null,
    });
  } catch (e) {
    // Return null gracefully — the frontend shows "—" when no quote data
    res.json(null);
  }
});

// ── Fallback → serve SPA ─────────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Earnings Intelligence Dashboard`);
  console.log(`   http://localhost:${PORT}\n`);
  console.log(`   Watchlist  : ${WATCHLIST_PATH}`);
  console.log(`   Summaries  : ${SUMMARIES_DIR}`);
  console.log(`   Environment: ${process.env.ANTHROPIC_API_KEY ? "✅ ANTHROPIC_API_KEY set" : "⚠️  ANTHROPIC_API_KEY missing (runs will fail)"}`);
});
