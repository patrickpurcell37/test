# Odlum Brown Multi-Factor Equity Scoring Model

A quantitative factor model that scores Odlum Brown's 46-stock coverage universe monthly on Value, Quality, Momentum, and Earnings Revision, then surfaces names with deteriorating factor profiles before price moves make them obvious.

---

## What the Model Does

Each month the pipeline:

1. Pulls adjusted monthly prices for all 46 coverage names via yfinance, converting all USD-denominated prices to CAD using the live USD/CAD exchange rate.
2. Pulls quarterly fundamental data (gross margin, ROIC, EV/EBITDA, P/B) from SimFin API (if API key is set) with automatic fallback to Macrotrends web scraping.
3. Pulls earnings history and computes EPS surprise and year-over-year EPS growth via yfinance.
4. Cleans and merges all data into a single long-format panel, with look-ahead bias prevention applied to fundamental inputs.
5. Computes four factor scores — Value, Quality, Momentum (12-1 month, CAD), Revision — each scaled 0–100 as a percentile rank within the universe.
6. Computes a weighted composite score (25% each factor) and flags stocks with large month-over-month moves.
7. Runs a full backtest (quintile returns, Spearman IC, factor decay, stress tests across oil crash / COVID / rate shock periods).
8. Outputs a ranked scorecard CSV and an interactive Streamlit dashboard.

---

## Project Structure

```
factor_model/
├── README.md
├── requirements.txt
├── .env.example
├── run_all.py              # Master pipeline — run this monthly
├── config.py               # Universe, sectors, parameters
├── data/
│   ├── raw/
│   │   ├── prices/         # Monthly price CSVs (CAD and local currency)
│   │   ├── fundamentals/   # Per-ticker fundamental CSVs
│   │   └── earnings/       # Per-ticker earnings CSVs
│   └── processed/
│       ├── factor_scores/  # panel_with_factors.csv
│       └── backtest_results/
├── src/
│   ├── data_pull.py        # Data ingestion (prices, fundamentals, earnings)
│   ├── data_clean.py       # Cleaning, panel construction
│   ├── factors.py          # Value, Quality, Momentum, Revision calculation
│   ├── backtest.py         # Quintile backtest, IC, stress tests
│   └── scoring.py          # Scorecard and flag notes generation
├── dashboard/
│   └── app.py              # Streamlit interactive dashboard
└── outputs/
    ├── scorecard_CURRENT.csv
    ├── methodology_note.md
    └── flag_notes.txt
```

---

## Setup

### Requirements

- Python 3.10 or higher
- pip

### Install dependencies

```bash
cd factor_model
pip install -r requirements.txt
```

### Configure API key (recommended)

The model uses SimFin for fundamental data (gross margin, ROIC, EV/EBITDA, P/B) with Macrotrends as an automatic fallback. For best coverage — especially for Canadian names — set a SimFin API key.

1. Get a free API key at https://simfin.com
2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
3. Edit `.env` and replace `your_simfin_api_key_here` with your actual key:
   ```
   SIMFIN_API_KEY=abc123yourkeyhere
   ```

If you skip this step, the model will fall back to Macrotrends web scraping for all fundamental data. This works but is slower and may produce gaps for some names. You will see a warning message when running without the API key.

---

## First Run

```bash
python run_all.py
```

**Expected duration:** 15–20 minutes on first run (downloading 11+ years of price data for 46 stocks plus fundamentals and earnings).

Subsequent runs are faster because yfinance caches some data and the fundamentals pipeline can reuse saved CSVs.

**What gets created:**
- `data/raw/prices/prices_monthly_cad.csv` — all prices in CAD
- `data/raw/prices/prices_monthly_local.csv` — prices in local currency
- `data/raw/fundamentals/` — per-ticker fundamental CSVs
- `data/raw/earnings/` — per-ticker earnings CSVs
- `data/processed/panel.csv` — merged long-format panel
- `data/processed/factor_scores/panel_with_factors.csv` — panel with factor scores
- `data/processed/backtest_results/` — IC series, quintile returns, stress tests
- `outputs/scorecard_CURRENT.csv` — current month's ranked scorecard
- `outputs/flag_notes.txt` — 2-sentence analyst notes for flagged stocks

---

## Monthly Refresh Workflow

At the start of each month:

```bash
python run_all.py
```

The pipeline always pulls fresh data up to today and regenerates all outputs. The previous month's scorecard is archived as `outputs/scorecard_YYYY_MM.csv`.

To view the interactive dashboard after running:

```bash
streamlit run dashboard/app.py
```

This opens a browser tab at `http://localhost:8501` with the full scorecard, stock detail view, and backtest charts.

---

## How to Interpret Factor Scores

All scores are **0–100 percentile ranks within the current 46-stock universe**. A score of 75 means the stock ranks better than 75% of coverage names on that factor in the current month. Scores are relative, not absolute — a score of 50 is the universe median, not "average" in any absolute sense.

| Score range | Interpretation |
|---|---|
| 75–100 | Top quartile — strong factor alignment |
| 50–74 | Above average — broadly positive signal |
| 25–49 | Below average — factor headwinds present |
| 0–24 | Bottom quartile — multiple factor deterioration |

**Composite score:** Weighted average (25% each) of Value, Quality, Momentum, and Revision, z-scored within each month and re-ranked to 0–100.

**Score delta:** Month-over-month change in composite score. Large moves (>8 points) trigger flags:
- **Rising:** Composite improved 8+ points — worth investigating for positive catalyst
- **Falling:** Composite dropped 8+ points — monitor for fundamental deterioration
- **Red flag:** Composite below 25 AND delta below -5 — highest monitoring priority; multiple factors deteriorating simultaneously

**Flag notes** in `outputs/flag_notes.txt` provide 2-sentence, quantitatively grounded summaries for all flagged stocks, referencing actual backtest hit rates.

---

## Notes on Canadian vs. US Names

**Currency:** All factor scores and backtest returns are in Canadian dollars. US-listed names (NYSE, NASDAQ) have their prices converted to CAD using the USD/CAD spot rate sourced from yfinance at each month-end. This means the momentum factor for US names captures both price performance in USD and any USD/CAD currency moves.

**Practical implication:** In periods of significant CAD weakness (e.g., 2015–2016, 2020), US-listed names will tend to score higher on momentum than they would on a pure USD basis. Analysts should note the prevailing currency regime when interpreting momentum scores for US names.

**Fundamental data coverage:** US-listed names generally have better coverage on SimFin and yfinance than Canadian names. If a Canadian name shows `data_source = 'none'` in the panel, its composite score is computed entirely from price-based factors (momentum) and any available earnings data, which reduces reliability. Check `outputs/error_log.txt` for specific data gaps.

---

## Note on MICC Exclusion

The ticker MICC (Magnum Ice Cream) was identified during initial universe construction but does not appear to be a standalone publicly traded equity on a major exchange. It has been excluded from the model universe. If Odlum Brown's coverage team believes this name should be included, verify the correct exchange ticker and add it to `config.py` in the `UNIVERSE` list along with the appropriate entries in `SECTORS`, `COMPANY_NAMES`, `LISTING_TYPE`, and either `TSX_TICKERS` or `US_TICKERS`.

---

## Data Sources and Limitations

| Data type | Primary source | Fallback |
|---|---|---|
| Monthly prices | yfinance (auto-adjusted) | None |
| USD/CAD exchange rate | yfinance (CAD=X) | Fixed 1.35 with warning |
| Fundamental ratios | SimFin API v3 | Macrotrends web scrape |
| EPS surprise | yfinance earnings_history | YoY EPS growth (yfinance) |

**Key limitations:**
- The backtest universe is the *current* coverage list, not a historical point-in-time list. Names that were covered in the past but dropped (e.g., due to poor performance or delistings) are not included, which introduces survivorship bias that overstates backtest performance.
- With only 46 names, each quintile contains ~9 stocks. Backtest IC and quintile spread estimates have high sampling error. Treat backtest statistics as directional signals, not precise forecasts.
- Macrotrends scraping can break if the site changes its page structure. Monitor `outputs/error_log.txt` for scrape failures and verify fundamental data coverage after each run.
- The model does not incorporate ESG screens, governance data, or Odlum Brown's qualitative analyst views. Factor scores should be used alongside — not instead of — fundamental research.

For full methodology details, see `outputs/methodology_note.md`.
