"""
run_all.py — Master pipeline script for Odlum Brown Factor Model.

Run: python run_all.py

Orchestrates full data pull, cleaning, factor calculation, backtest, and scorecard generation.
Allow 15-20 minutes for full data pull on first run.
"""

import sys
import warnings
from datetime import datetime
from pathlib import Path

warnings.filterwarnings('ignore')

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv()

import os


def main():
    print("\n" + "=" * 56)
    print("ODLUM BROWN FACTOR MODEL — STARTING RUN")
    print("=" * 56)
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Startup warnings
    print("\nNote: MICC (Magnum Ice Cream) excluded from universe —")
    print("   does not appear to be a standalone public company.")
    print("   Confirm ticker with Odlum Brown if coverage is required.")

    if not os.getenv('SIMFIN_API_KEY'):
        print("\nSIMFIN_API_KEY not set — fundamentals will use Macrotrends fallback only.")
        print("   Set SIMFIN_API_KEY in .env file for best results.")

    # --- Step 1: Pull data ---
    print("\n[1/7] Pulling raw data...")
    from src.data_pull import pull_prices, pull_fundamentals, pull_earnings
    from config import UNIVERSE, START_DATE

    prices_cad, prices_local = pull_prices(UNIVERSE, start=START_DATE)
    fundamentals = pull_fundamentals(UNIVERSE)
    earnings = pull_earnings(UNIVERSE)

    # --- Step 2: Clean data ---
    print("\n[2/7] Cleaning data...")
    from src.data_clean import clean_prices, clean_fundamentals, build_panel

    prices_cad_clean = clean_prices(prices_cad)
    fundamentals_clean = clean_fundamentals(fundamentals)
    panel = build_panel(prices_cad_clean, fundamentals_clean, earnings)

    # --- Step 3: Calculate factors ---
    print("\n[3/7] Calculating factors...")
    from src.factors import run_all_factors

    panel = run_all_factors(panel)

    # --- Step 4: Backtest ---
    print("\n[4/7] Running backtests...")
    from src.backtest import run_full_backtest

    backtest_results = run_full_backtest(panel)

    # --- Step 5: Generate scorecard ---
    print("\n[5/7] Generating scorecard...")
    from src.scoring import generate_monthly_scorecard, generate_flag_notes

    scorecard = generate_monthly_scorecard(panel)
    flag_notes = generate_flag_notes(scorecard, backtest_results)

    # --- Step 6: Save flag notes ---
    print("\n[6/7] Saving flag notes...")
    notes_path = ROOT / 'outputs' / 'flag_notes.txt'
    with open(notes_path, 'w') as f:
        for ticker, note in flag_notes.items():
            f.write(f"\n{ticker}:\n{note}\n")

    # --- Step 7: Write refresh timestamp ---
    print("\n[7/7] Writing refresh timestamp...")
    (ROOT / 'outputs' / 'last_refresh.txt').write_text(datetime.now().isoformat())

    # --- Final summary ---
    latest = panel[panel['date'] == panel['date'].max()]
    ic_stats = backtest_results.get('composite', {}).get('ic_stats', {})
    mean_ic = ic_stats.get('mean_ic', float('nan'))

    covered_with_data = panel.groupby('ticker')['ev_ebitda'].apply(lambda x: x.notna().any()).sum()

    top5 = scorecard.head(5)
    big_movers = scorecard.nlargest(2, 'score_delta')
    big_fallers = scorecard.nsmallest(2, 'score_delta')
    red_flags = scorecard[scorecard['flag'] == 'Red flag']

    print("\n" + "=" * 56)
    print("ODLUM BROWN FACTOR MODEL — RUN COMPLETE")
    print("=" * 56)
    print(f"Universe:      {len(scorecard)} stocks | 11 sectors")
    print(f"TSX names:     26 | US/International: 20")
    print(f"Data coverage: {covered_with_data}/{len(scorecard)} tickers with fundamentals")
    print(f"Date range:    {panel['date'].min().strftime('%Y-%m-%d')} to {panel['date'].max().strftime('%Y-%m-%d')}")
    ic_display = f"{mean_ic:.3f}" if mean_ic == mean_ic else "N/A"
    print(f"Backtest IC:   {ic_display} (composite, mean monthly)")

    print("\nTOP 5 THIS MONTH:")
    for _, row in top5.iterrows():
        print(f"  {int(row['rank'])}. {row['ticker']} ({row['sector']}) — composite {row['composite_score']:.0f}")

    print("\nBIGGEST MOVERS:")
    for _, row in big_movers.iterrows():
        delta = row['score_delta']
        if delta == delta:  # not nan
            print(f"  {row['ticker']} +{delta:.0f} pts")
    for _, row in big_fallers.iterrows():
        delta = row['score_delta']
        if delta == delta:
            print(f"  {row['ticker']} {delta:.0f} pts")

    print("\nRED FLAGS THIS MONTH:")
    if red_flags.empty:
        print("  None")
    else:
        for _, row in red_flags.iterrows():
            note = flag_notes.get(row['ticker'], '')
            note_short = note[:80] + '...' if len(note) > 80 else note
            print(f"  {row['ticker']} (score: {row['composite_score']:.0f}) — {note_short}")

    print("\nLaunch dashboard: streamlit run dashboard/app.py")
    print("=" * 56 + "\n")


if __name__ == '__main__':
    main()
