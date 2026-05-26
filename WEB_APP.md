# EarningsIQ — Web Dashboard

A Quartr-inspired earnings intelligence web app that runs on top of your earnings summarizer.

## What it does

| Feature | Description |
|---|---|
| **Watchlist** | See all your tracked companies, live prices, last earnings event, enable/disable monitoring |
| **Earnings Calendar** | Upcoming earnings dates + historical EPS surprises for your watchlist |
| **Summaries** | Browse and read every AI-generated earnings analysis (rendered markdown) |
| **Company Search** | Search any ticker or company name and add it to your watchlist instantly |

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up your `.env` file (copy from existing setup)
```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
TO_EMAIL=you@gmail.com
```

### 3. Start the server
```bash
npm start
# or
node server.js
```

Open **http://localhost:3000** in your browser.

---

## Deploying to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add the environment variables from your `.env` file in Railway's dashboard
4. Railway auto-detects Node.js and runs `npm start`
5. Your app gets a public URL like `https://earningsiq-production.up.railway.app`

## Deploying to Render

1. Go to [render.com](https://render.com) → New Web Service → Connect GitHub
2. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
3. Add your environment variables
4. Deploy

---

## Using the Dashboard

### Running an Earnings Check
Click **Run Now** on any company card. A live log stream shows exactly what's happening:
- Phase 1: Discovering transcript candidates
- Phase 2: Fetching the selected transcript
- Summarizing with Claude AI
- Generating PDF + sending email

### Adding Companies
- Click **Add Company** and enter a ticker + name
- Or go to **Search**, find any stock, and click **+ Add**

### Reading Summaries
Click **Summaries** in the sidebar → select any entry from the left panel. The AI analysis renders with full formatting. Click **PDF** to download the premium report.

---

## Architecture

```
server.js          Express backend (port 3000)
public/
  index.html       SPA shell
  js/app.js        Frontend (vanilla JS)
  css/styles.css   Dark premium theme

lib/
  checker.js       Transcript fetch + AI summarization pipeline
  email.js         Gmail SMTP delivery
  pdf-generator.js Puppeteer PDF reports

scheduler.js       CLI runner (used by server + GitHub Actions)
watchlist.json     Persistent state (companies + last processed dates)
summaries/         Generated markdown + PDF files
skill.md           Your custom AI analysis template
```
