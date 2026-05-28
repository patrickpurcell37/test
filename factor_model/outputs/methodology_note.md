# Odlum Brown Multi-Factor Equity Scoring Model — Methodology Note

**Version:** 1.0  
**Date:** May 2026  
**Prepared for:** Odlum Brown Limited — Equity Research

---

## 1. Purpose

Odlum Brown's equity analysts cover a concentrated universe of high-conviction names across North America. The problem this model solves is a systematic one: given 46 stocks across 11 sectors and two currency regimes, how should an analyst quickly identify which names are deteriorating on multiple quantitative dimensions simultaneously — before a price decline makes that obvious?

The model does not replace fundamental research. It serves as a quantitative pre-screen that surfaces names deserving closer analytical attention, flags stocks where momentum and earnings revisions are rolling over together, and provides a statistically defensible ranking against which fundamental overrides can be documented and tracked.

The output is a monthly scorecard — a single ranked list of all 46 coverage names, scored 0–100 on four factors (Value, Quality, Momentum, Revision) and a weighted composite. The scorecard is designed to be legible to a portfolio manager in under two minutes and drillable by an analyst in the Streamlit dashboard.

---

## 2. Universe

The model covers **46 stocks** across **11 GICS-aligned sectors**:

| Sector | Tickers | Count |
|---|---|---|
| Financials | RY, POW, BMO, BN, V, PGR, TD, MCO, FFH, IFC | 10 |
| Energy | CVE, CNQ, TOU, PPL, ENB, TRP | 6 |
| Info Tech | MSFT, CSU, TEL, AAPL, GIB.A, VNT | 6 |
| Utilities | BEP.UN, AEP, FTS, BIP.UN | 4 |
| Industrials | JHX, TDG, CP, FTT | 4 |
| Consumer Staples | UL, MDLZ, ATD | 3 |
| Materials | CCL.B, NTR, ALB | 3 |
| Consumer Disc. | DOL, ABNB, AMZN | 3 |
| Health Care | SYK, GEHC, ENOV | 3 |
| Comm. Services | GOOG, RCI.B | 2 |
| Real Estate | FSV | 1 |

**Listing breakdown:** 26 TSX-listed, 19 US-listed (NYSE/NASDAQ), 1 ADR (JHX on NYSE).

**Note on exclusions:** MICC (Magnum Ice Cream) was flagged during universe construction but does not appear to be a standalone public company with exchange-traded equity. Confirm with Odlum Brown coverage team if this name requires inclusion.

---

## 3. Currency Methodology

All factor scores and backtest returns are expressed in **Canadian dollars (CAD)**.

**Why CAD conversion matters:** Odlum Brown's clients hold portfolios denominated in CAD. A US-listed stock that generates 15% USD return but declines 5% against CAD delivers only ~10% in the client's functional currency. To rank names consistently on a risk-adjusted basis, all prices must share a currency base.

**Implementation:**
- TSX-listed tickers are priced in CAD natively (no conversion required).
- US-listed and ADR tickers are priced in USD by yfinance and converted to CAD by multiplying by the USD/CAD spot rate sourced daily from yfinance (`CAD=X`), resampled to month-end.
- If the `CAD=X` feed fails on any given pull, a fixed fallback rate of 1.35 CAD/USD is used and logged in `outputs/error_log.txt`. This should be verified manually before distributing the scorecard.

**Momentum:** The 12-1 month momentum factor is calculated entirely in CAD-converted prices, meaning currency effects are captured within the momentum signal. This is intentional: a US name that has underperformed in CAD terms (even if strong in USD) should score lower on momentum from a Canadian portfolio perspective.

---

## 4. Factor Definitions

### 4.1 Value Factor (weight: 25%)

**Academic rationale:** The value premium — cheap stocks outperforming expensive ones — is one of the most replicated findings in empirical finance (Fama & French 1992, Lakonishok et al. 1994). The mechanism is debated (risk vs. mispricing), but the empirical regularity is robust across markets and time periods.

**Metrics used:**
- **EV/EBITDA** (enterprise value to EBITDA): preferred over P/E because it is capital-structure neutral and less sensitive to one-time charges. Lower = cheaper = better score.
- **Price-to-Book** (P/B): captures asset-based cheapness, particularly relevant for financials and capital-intensive businesses. Lower = cheaper = better score.

**Calculation:**
1. Invert both metrics (multiply by -1) so lower multiples map to higher raw scores.
2. Apply sector neutralization (see Section 5) to each metric independently.
3. Average the two sector-neutralized z-scores (NaN-safe: if one metric is missing, use the other alone).
4. Percentile-rank the average to a 0–100 scale within the universe cross-section.

**Known structural behavior:** High-growth US platform businesses (AAPL, AMZN, MSFT, GOOG) will structurally score in the bottom quartile on Value. This is correct and expected — they trade at premiums that are partially justified by superior growth and returns on capital. The value factor should be read alongside Quality and Momentum for these names.

### 4.2 Quality Factor (weight: 25%)

**Academic rationale:** Profitability and earnings quality predict future returns (Novy-Marx 2013, Fama & French 2015). High-ROIC businesses with expanding margins tend to compound returns above cost of capital for longer than the market's base-rate assumptions embed.

**Metrics used:**
- **ROIC** (return on invested capital): the single most important measure of business quality. Defined as NOPAT / invested capital; sourced from SimFin or Macrotrends.
- **Gross margin trend**: a 4-period rolling linear slope of gross margin. Rising margins indicate pricing power or improving unit economics; declining margins are an early warning of competitive pressure.

**Calculation:**
1. Compute gross margin trend per ticker using a rolling OLS slope over 4 months in the monthly panel (equivalent to 4 quarters of quarterly data).
2. Apply sector neutralization to ROIC and gross margin trend independently.
3. Average the two sector-neutralized z-scores (NaN-safe).
4. Percentile-rank to 0–100.

### 4.3 Momentum Factor (weight: 25%)

**Academic rationale:** Price momentum — the tendency of recent winners to continue outperforming recent losers — is documented across virtually every market studied (Jegadeesh & Titman 1993, Asness et al. 2013). The 12-1 month window (12-month trailing return minus the most recent month) is the most widely validated specification.

**Calculation:**
1. Use CAD-adjusted monthly close prices (see Section 3).
2. Compute 12-month trailing return (`t-12` to `t`).
3. Subtract 1-month trailing return (`t-1` to `t`) to implement the **skip-month convention**, which avoids contamination from short-term price reversal documented at the 1-month horizon.
4. Require minimum 10 months of price history to assign a momentum score; otherwise assigned NaN.
5. Percentile-rank to 0–100 **universe-wide** (no sector neutralization applied to momentum, as momentum is most powerful as a pure cross-sectional rank signal).

### 4.4 Revision Factor (weight: 25%)

**Academic rationale:** Earnings estimate revisions are among the most reliable near-term predictors of equity returns. Analysts revise estimates slowly and anchored to prior estimates (Chan et al. 1996), creating momentum in fundamental expectations that is distinct from price momentum.

**Primary signal:** Rolling 2-quarter average EPS surprise percentage (actual EPS minus consensus estimate, divided by absolute consensus). Averaging over 2 periods smooths noise from one-off beats/misses.

**Fallback signal:** If EPS surprise data is unavailable (particularly common for smaller Canadian names not covered by large US data providers), year-over-year EPS growth from quarterly income statements (via yfinance) is substituted.

**Calculation:**
1. Compute EPS surprise pct or YoY EPS growth per ticker per available date.
2. Smooth with 2-period rolling mean.
3. Percentile-rank to 0–100 universe-wide (no sector neutralization).

---

## 5. Small Sector Handling

Five sectors in the universe contain fewer than 4 stocks: Real Estate (1), Comm. Services (2), Materials (3), Health Care (3), and Consumer Disc. (3). Sector neutralization is mathematically unstable — and conceptually misleading — for groups this small: subtracting a 3-stock sector median removes so much cross-sectional dispersion that the resulting z-scores are essentially meaningless.

**Rule:** Any sector with fewer than `MIN_SECTOR_SIZE_FOR_NEUTRALIZATION = 4` stocks uses universe-wide z-scoring instead of sector-level neutralization. This means names in small sectors compete for value and quality rankings against the full 46-stock universe rather than only against their 2–3 sector peers.

This is a deliberate design choice. The alternative — forcing sector neutralization on a 2-stock sector — would award one stock a top score and the other a bottom score regardless of their absolute quality, which is uninformative and potentially misleading.

---

## 6. Composite Score Construction

**Step 1 — Monthly cross-sectional z-scores:** Within each calendar month, each of the four 0–100 factor scores is z-scored across the universe. This removes systematic differences in factor scale and ensures that a factor with higher average scores doesn't dominate the composite.

**Step 2 — Weighted average:** The four z-scores are combined using equal weights of 25% each. If a factor score is NaN for a given stock in a given month, that factor's weight is redistributed proportionally among the non-missing factors. This ensures the composite remains meaningful even for names with partial data coverage.

**Step 3 — Percentile ranking:** The weighted average z-score is percentile-ranked within the universe to a 0–100 final composite score. A score of 75 means the stock ranks in the 75th percentile of the universe on that month's composite signal — better than 75% of coverage names.

**Why re-rank rather than use the raw weighted z-score?** Percentile ranks are:
(a) always bounded 0–100 regardless of universe size or factor volatility,
(b) easily interpretable without statistical background,
(c) robust to outliers that would inflate or deflate absolute z-score distributions.

**Score interpretation guide:**
- 75–100: Top quartile; broadly positive factor alignment
- 50–74: Above average; watch for confirmation of catalysts
- 25–49: Below average; factor headwinds present
- 0–24: Bottom quartile; multiple factor deterioration; highest monitoring priority

---

## 7. Backtest Methodology

**Data period:** January 2014 to present (approximately 11 years).

**Data sources:**
- Prices: yfinance (adjusted for splits and dividends, auto_adjust=True)
- Fundamentals: SimFin API v3 (primary), Macrotrends web scraping (fallback)
- Earnings: yfinance earnings_history and quarterly_income_stmt

**Look-ahead bias prevention:** This is the most critical methodological safeguard. Fundamental data is subject to reporting lags: Q1 earnings reported in April cannot be acted upon until May at the earliest. The model applies `shift(1)` to all quarterly fundamental data before upsampling to monthly frequency. This means Q1 data enters the model in the period *after* it was published, as if the investor could only act on information already in the public domain.

Price momentum is inherently point-in-time — the price at month-end `t` is the last information available at that date — so no shift is applied to price data.

**Quintile backtest methodology:** Each month, stocks are sorted into five equal quintiles by factor score. Q1 contains the top 20% (highest scorers), Q5 the bottom 20%. Equal-weight average forward returns are computed for each quintile at 1-, 3-, 6-, and 12-month horizons. The key statistic is the Q1–Q5 spread: positive spread means higher-scored stocks outperformed lower-scored stocks on average.

**Information Coefficient (IC):** The Spearman rank correlation between factor scores at month `t` and realized returns at month `t+1`. Spearman (rather than Pearson) is used because it is robust to non-normality and outliers in return distributions. A mean IC > 0.03 is generally considered economically meaningful for monthly signals.

**Factor decay analysis:** IC is computed at horizons 1 through 6 months to assess how quickly signal information is incorporated into prices.

**Transaction cost assumption:** 15 basis points (bps) round-trip per trade, applied to gross quintile returns using assumed average monthly portfolio turnover.

**Stress test periods:**
- Oil price crash: July 2014 – June 2016 (tests factor behavior in commodity downturn with CAD depreciation)
- COVID shock: January 2020 – December 2020 (tests factor behavior in sudden growth shock + recovery)
- Rate normalization: January 2022 – June 2023 (tests factor behavior in rising rate environment that differentially impacted growth vs. value)

---

## 8. Key Results

The following statistics will be populated after the first full pipeline run:

- **Composite mean IC (1-month horizon):** [INSERT MEAN IC]
- **Q1–Q5 annualized spread:** [INSERT Q1-Q5 SPREAD ANN]
- **Composite Q1 portfolio Sharpe ratio:** [INSERT SHARPE]
- **Maximum drawdown of Q1–Q5 spread portfolio:** [INSERT MAX DD]

Run `python run_all.py` and refer to `data/processed/backtest_results/` for computed values.

---

## 9. Known Model Limitations

**1. Small universe cross-section:** With 46 stocks, each quintile contains approximately 9 names. This creates high sampling error in quintile return estimates. The IC and quintile spread statistics should be interpreted as directional signals, not precise point estimates. A universe of 100+ names would provide materially more stable backtest statistics.

**2. Survivorship bias:** The current universe represents Odlum Brown's *current* coverage list. Stocks that were covered in the past but have since been dropped (due to poor performance, takeover, or reduced relevance) are not included. This biases backtest returns upward to an unknown degree.

**3. Fundamental data gaps:** Canadian-listed names have lower coverage on US data providers (SimFin, yfinance) than US-listed names. Several TSX names may have partial or lagged fundamental data. The data_source column in the panel tracks this. Names with data_source = 'none' rely entirely on momentum and revision factors, reducing composite score reliability.

**4. Look-back period concentration:** The 2014–present backtest period includes two specific macro regimes (low rates 2014–2021, rate normalization 2022–2023) that may not represent the full distribution of future environments. The model is not regime-aware.

**5. Currency translation risk:** Using spot USD/CAD at month-end to convert US prices to CAD introduces currency translation noise into the momentum signal. A theoretically cleaner approach would use hedged returns, but hedging costs are not available historically for this universe.

**6. No ESG or governance filters:** The model ranks purely on financial factors. ESG considerations relevant to Odlum Brown's client mandates are not captured and must be applied as overlays by the analyst.

**7. Macrotrends scraping fragility:** The Macrotrends fallback relies on parsing JavaScript variables from a third-party website. This method can break if Macrotrends changes its page structure. If fundamental data coverage drops unexpectedly, check `outputs/error_log.txt` and verify the Macrotrends scraper is still functional.

---

## 10. How to Use the Scorecard

**Monthly workflow:**
1. Run `python run_all.py` (approximately 15–20 minutes on first run; faster on subsequent runs if data is cached).
2. Open `outputs/scorecard_CURRENT.csv` or launch `streamlit run dashboard/app.py` for the interactive view.
3. Sort by `score_delta` (month-over-month change) to identify names with the largest score moves — both up and down.
4. Review all names with `flag = 'Red flag'` or `flag = 'Falling'`. These are the highest-priority names for analyst follow-up.
5. Cross-reference flagged names against fundamental research. The model is a screen, not a recommendation — a high-scoring name that an analyst believes is fundamentally broken should be a sell regardless of factor score.

**Score interpretation:**
- The composite score is a relative ranking within the current 46-stock universe. A score of 80 means better than 80% of coverage on that month's combined factor signal. It is not an absolute measure of quality.
- Factor scores (value, quality, momentum, revision) follow the same 0–100 scale within the same universe. A stock can score 90 on momentum but 20 on value — this divergence is itself informative (momentum without value support is more likely to revert).
- The `score_delta` column shows the month-over-month change in composite score. Large positive deltas (>8 pts) trigger a "Rising" flag; large negative deltas (<-8 pts) trigger "Falling"; scores below 25 combined with delta <-5 trigger "Red flag."

**For US-listed names:** Factor scores are calculated on a currency-consistent basis (all returns in CAD). However, the analyst should note that strong USD/CAD tailwinds can inflate momentum scores for US names in periods of CAD weakness — check the currency regime before attributing momentum to stock-specific drivers.

---

## 11. Next Steps

The following enhancements are recommended for future model versions:

1. **Expand universe:** Adding names from Odlum Brown's broader watchlist (30–50 additional names) would dramatically improve the statistical power of backtest IC estimates and quintile returns.

2. **Add analyst estimate consensus data:** A Bloomberg or FactSet integration would provide more reliable EPS estimate consensus and revision data, replacing the yfinance/Macrotrends fallback chain for Canadian names.

3. **Regime-conditional scoring:** Implement a macro regime detector (e.g., yield curve slope, credit spreads) that adjusts factor weights dynamically — e.g., overweighting value in low-rate periods, overweighting quality in recessionary environments.

4. **Dividend yield factor:** For income-oriented coverage names (ENB, BEP.UN, BIP.UN, FTS, AEP), adding a dividend yield and payout sustainability sub-factor would better capture the total-return valuation relevant to Odlum Brown's client base.

5. **Automated monthly email report:** A PDF or HTML scorecard generated automatically at month-end and distributed to the research team via email, triggered by a cron job running `python run_all.py`.

6. **Position sizing overlay:** Translate composite scores into suggested portfolio weight tilts relative to a benchmark, subject to sector and single-name concentration limits.

7. **Historical scorecard archive:** The pipeline already saves monthly scorecard CSVs with date stamps. Building a longitudinal view of how each stock's composite score has evolved over time would provide additional context for discussing score changes with portfolio managers.
