"""
run_pipeline_synthetic.py — Run the full factor/backtest/scoring pipeline on synthetic data.

Call this after generate_synthetic_data.py has been run.
Skips the network data-pull step; loads pre-generated CSVs directly.
"""

import sys
import warnings
from datetime import datetime
from pathlib import Path

warnings.filterwarnings('ignore')

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd

from config import UNIVERSE, SECTORS, COMPANY_NAMES, LISTING_TYPE, START_DATE

RAW_PRICES_DIR  = ROOT / 'data' / 'raw' / 'prices'
RAW_FUND_DIR    = ROOT / 'data' / 'raw' / 'fundamentals'
RAW_EARN_DIR    = ROOT / 'data' / 'raw' / 'earnings'


def load_fundamentals():
    result = {}
    for ticker in UNIVERSE:
        fname = ticker.replace('.', '_').replace('/', '_') + '_fundamentals.csv'
        path = RAW_FUND_DIR / fname
        if path.exists():
            df = pd.read_csv(path, parse_dates=['date'])
            result[ticker] = df
        else:
            result[ticker] = pd.DataFrame()
    return result


def load_earnings():
    result = {}
    for ticker in UNIVERSE:
        fname = ticker.replace('.', '_').replace('/', '_') + '_earnings.csv'
        path = RAW_EARN_DIR / fname
        if path.exists():
            df = pd.read_csv(path, parse_dates=['date'])
            result[ticker] = df
        else:
            result[ticker] = pd.DataFrame()
    return result


def main():
    print("\n" + "="*56)
    print("ODLUM BROWN FACTOR MODEL — SYNTHETIC DATA PIPELINE")
    print("="*56)
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("NOTE: Using synthetic data (network restricted environment).")
    print("      Re-run with live data once network access is available.")

    # ── 1. Load prices ────────────────────────────────────────────
    print("\n[1/6] Loading prices...")
    prices_cad = pd.read_csv(RAW_PRICES_DIR / 'prices_monthly_cad.csv', index_col=0, parse_dates=True)
    prices_cad.index = pd.to_datetime(prices_cad.index)
    # Drop rows with NaT index
    prices_cad = prices_cad[prices_cad.index.notna()]
    print(f"  Loaded {prices_cad.shape[1]} tickers × {prices_cad.shape[0]} months")

    # ── 2. Load fundamentals & earnings ──────────────────────────
    print("[2/6] Loading fundamentals and earnings...")
    fundamentals = load_fundamentals()
    earnings     = load_earnings()
    print(f"  Fundamentals: {sum(1 for v in fundamentals.values() if not v.empty)}/{len(UNIVERSE)} tickers")
    print(f"  Earnings:     {sum(1 for v in earnings.values() if not v.empty)}/{len(UNIVERSE)} tickers")

    # ── 3. Clean & build panel ───────────────────────────────────
    print("[3/6] Cleaning data and building panel...")
    from src.data_clean import clean_prices, clean_fundamentals, build_panel

    prices_cad_clean   = clean_prices(prices_cad)
    fundamentals_clean = clean_fundamentals(fundamentals)
    panel              = build_panel(prices_cad_clean, fundamentals_clean, earnings)

    # ── 4. Calculate factors ─────────────────────────────────────
    print("[4/6] Calculating factors...")
    from src.factors import run_all_factors

    panel = run_all_factors(panel)

    # ── 5. Backtest ──────────────────────────────────────────────
    print("[5/6] Running backtests...")
    from src.backtest import run_full_backtest

    backtest_results = run_full_backtest(panel)

    # Save monthly Q1/Q5 for dashboard cumulative chart
    if 'composite' in backtest_results:
        mq = backtest_results['composite']['quintile_backtest']['monthly']
        mq.to_csv(ROOT / 'data' / 'processed' / 'backtest_results' / 'composite_monthly_q1q5.csv', index=False)

    # ── 6. Scorecard & flag notes ────────────────────────────────
    print("[6/6] Generating scorecard...")
    from src.scoring import generate_monthly_scorecard, generate_flag_notes

    scorecard  = generate_monthly_scorecard(panel)
    flag_notes = generate_flag_notes(scorecard, backtest_results)

    notes_path = ROOT / 'outputs' / 'flag_notes.txt'
    with open(notes_path, 'w') as f:
        for ticker, note in flag_notes.items():
            f.write(f"\n{ticker}:\n{note}\n")

    (ROOT / 'outputs' / 'last_refresh.txt').write_text(datetime.now().isoformat())

    # ── Final summary ─────────────────────────────────────────────
    ic_stats = backtest_results.get('composite', {}).get('ic_stats', {})
    mean_ic  = ic_stats.get('mean_ic', float('nan'))
    ic_display = f"{mean_ic:.3f}" if mean_ic == mean_ic else "N/A"

    covered = panel.groupby('ticker')['ev_ebitda'].apply(lambda x: x.notna().any()).sum()
    top5    = scorecard.head(5)
    movers  = scorecard.nlargest(2, 'score_delta')
    fallers = scorecard.nsmallest(2, 'score_delta')
    flags   = scorecard[scorecard['flag'] == 'Red flag']

    print("\n" + "="*56)
    print("ODLUM BROWN FACTOR MODEL — RUN COMPLETE")
    print("="*56)
    print(f"Universe:      {len(scorecard)} stocks | 11 sectors")
    print(f"TSX names:     26 | US/International: 19")
    print(f"Data coverage: {covered}/{len(scorecard)} tickers with fundamentals")
    print(f"Date range:    {panel['date'].min().strftime('%Y-%m-%d')} to {panel['date'].max().strftime('%Y-%m-%d')}")
    print(f"Backtest IC:   {ic_display} (composite, mean monthly)")

    print("\nTOP 5 THIS MONTH:")
    for _, row in top5.iterrows():
        delta = f"+{row['score_delta']:.0f}" if row['score_delta'] > 0 else f"{row['score_delta']:.0f}"
        print(f"  {int(row['rank'])}. {row['ticker']} ({row['sector']}) — composite {row['composite_score']:.0f}  Δ{delta}")

    print("\nBIGGEST MOVERS:")
    for _, row in movers.iterrows():
        d = row['score_delta']
        if d == d:
            print(f"  ↑ {row['ticker']} +{d:.0f} pts")
    for _, row in fallers.iterrows():
        d = row['score_delta']
        if d == d:
            print(f"  ↓ {row['ticker']} {d:.0f} pts")

    print("\nRED FLAGS THIS MONTH:")
    if flags.empty:
        print("  None")
    else:
        for _, row in flags.iterrows():
            print(f"  ⚠  {row['ticker']} (score: {row['composite_score']:.0f})")

    print("\nLaunch dashboard: streamlit run dashboard/app.py")
    print("="*56 + "\n")


if __name__ == '__main__':
    main()
