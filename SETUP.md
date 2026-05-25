# Earnings Alert System — Setup Guide

Automated earnings call transcripts → AI summary → email to your inbox.
Runs on GitHub Actions (free, no server needed).

---

## How It Works

```
GitHub Actions (daily cron)
    ↓
scheduler.js checks watchlist.json
    ↓
For each company with a new earnings call:
    Claude AI fetches the transcript (agentic web search)
    ↓
    claude-opus-4-7 + extended thinking summarizes using your skill.md
    ↓
    Gmail sends you a formatted HTML email
    ↓
    watchlist.json state is updated (won't re-send same transcript)
```

---

## Step 1 — Get a Gmail App Password

> You need this because Gmail doesn't allow your regular password for scripts.

1. Go to [myaccount.google.com/security](https://myaccount.google.com/security)
2. Make sure **2-Step Verification is ON** (required for App Passwords)
3. Search for **"App passwords"** in the search bar at the top
4. Click **App passwords → Create**
5. Name it anything (e.g. "Earnings Bot")
6. Copy the **16-character password** (format: `xxxx xxxx xxxx xxxx`)  
   → Save it — you'll need it in Step 2

---

## Step 2 — Add GitHub Secrets

> These are encrypted — no one (not even you) can read them after saving.

Go to your repo on GitHub:  
**Settings → Secrets and variables → Actions → New repository secret**

Add these 4 secrets:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com) |
| `GMAIL_USER` | Your Gmail address (e.g. `you@gmail.com`) |
| `GMAIL_APP_PASSWORD` | The 16-char App Password from Step 1 (no spaces) |
| `TO_EMAIL` | Where to send summaries (can be same as `GMAIL_USER`) |

---

## Step 3 — Customize Your Watchlist

Edit `watchlist.json` to add the companies you want to track:

```json
{
  "companies": [
    { "name": "NVIDIA",    "ticker": "NVDA", "lastProcessedDate": null, "enabled": true },
    { "name": "Apple",     "ticker": "AAPL", "lastProcessedDate": null, "enabled": true },
    { "name": "Microsoft", "ticker": "MSFT", "lastProcessedDate": null, "enabled": true },
    { "name": "Tesla",     "ticker": "TSLA", "lastProcessedDate": null, "enabled": true }
  ]
}
```

- Add any company with its ticker symbol
- Set `"enabled": false` to pause a company without deleting it
- `lastProcessedDate` is managed automatically — don't edit it manually

---

## Step 4 — Customize Your Summary Style

Edit `skill.md` to change how the AI analyzes and formats each summary.

The default template includes:
- 📋 Executive Snapshot
- 📊 Key Financial Metrics (table format)
- 🗣️ Management Tone & Narrative
- 🔑 Key Themes & Catalysts
- ⚠️ Risks & Red Flags
- 🔮 Guidance & Outlook
- ❓ Notable Q&A Moments
- 💡 Investment Signal

**You can:**
- Add sections (e.g. "Track ESG commitments", "Compare to my thesis")
- Remove sections you don't want
- Change the tone (more technical, shorter, bullet-only)
- Add company-specific instructions at the bottom

---

## Step 5 — Enable GitHub Actions

The workflow file is already at `.github/workflows/earnings-alert.yml`.

1. Push this repo to GitHub (if not already)
2. Go to **Actions** tab → you'll see "📊 Earnings Alert"
3. Click **Run workflow** to test it manually right now

The scheduled run happens every **weekday at 9 AM ET** automatically.

---

## Running Manually (Optional)

Test locally before pushing:

```bash
# Install dependencies
npm install

# Copy and fill in credentials
cp .env.example .env
# Edit .env with your keys

# Test a single company
node earnings-summarizer.js --company "NVIDIA"

# Run the full watchlist check
node scheduler.js

# Run as a local daemon (checks every weekday at 9 AM)
node scheduler.js --daemon
```

---

## Triggering a Specific Company Manually

From GitHub Actions UI:
1. Go to **Actions → 📊 Earnings Alert → Run workflow**
2. In the **"Override: check only this ticker"** field, enter e.g. `NVDA`
3. This forces a check (and re-summary) for that company, ignoring the last processed date

---

## Schedule Configuration

Edit `.github/workflows/earnings-alert.yml` to change when it runs:

```yaml
schedule:
  - cron: "0 14 * * 1-5"   # 9 AM ET, Mon–Fri (default)
  - cron: "0 20 * * 1-5"   # also 3 PM ET (catches afternoon calls same day)
```

[Crontab.guru](https://crontab.guru) is handy for building cron expressions.

---

## Troubleshooting

**Email not arriving?**
- Check spam/junk folder
- Verify `GMAIL_APP_PASSWORD` has no spaces (copy without spaces)
- Make sure 2-Step Verification is enabled on your Google account
- Check the GitHub Actions run logs for error messages

**"No new transcript found" every day?**
- The transcript may not be published yet — check the company's IR page
- Try manually triggering with the company ticker to force a re-check

**Summary quality issues?**
- Edit `skill.md` to add more specific instructions
- Try adding: "Focus on [specific metric]" or "Always include [specific section]"
