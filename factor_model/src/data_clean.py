"""
src/data_clean.py — Data cleaning and panel construction for Odlum Brown Factor Model.

Cleans price and fundamental data, then merges into a unified long-format panel
with look-ahead bias prevention applied to fundamental data.
"""

from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import mstats

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    UNIVERSE, SECTORS, LISTING_TYPE, COMPANY_NAMES,
    TSX_TICKERS, US_TICKERS, START_DATE, WINSORIZE_LIMITS
)

PROCESSED_DIR = Path(__file__).parent.parent / 'data' / 'processed'
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def clean_prices(prices_df):
    """
    Clean monthly price DataFrame: forward-fill gaps, drop thin tickers.

    Args:
        prices_df: DataFrame indexed by month-end date, columns = canonical tickers

    Returns:
        Cleaned DataFrame (same shape minus dropped tickers)
    """
    df = prices_df.copy()

    # Forward-fill up to 3 consecutive months
    df = df.ffill(limit=3)

    # Drop tickers with >20% missing values
    missing_pct = df.isna().mean()
    drop_tickers = missing_pct[missing_pct > 0.20].index.tolist()
    if drop_tickers:
        print(f"  Dropping {len(drop_tickers)} tickers with >20% missing prices: {drop_tickers}")
        df = df.drop(columns=drop_tickers)

    return df


def _winsorize_series(s, limits=WINSORIZE_LIMITS):
    """Winsorize a Series at given percentile limits, returning a new Series."""
    clean = s.dropna()
    if len(clean) < 5:
        return s
    lo = clean.quantile(limits[0])
    hi = clean.quantile(limits[1])
    return s.clip(lower=lo, upper=hi)


def clean_fundamentals(fundamentals_dict):
    """
    Standardize, deduplicate, and upsample quarterly fundamental data to monthly.

    Applies shift(1) to prevent look-ahead bias: fundamental data published in
    quarter Q only enters the model the following period, as if an investor
    could only act on data after it's publicly available.

    Args:
        fundamentals_dict: dict of {ticker: DataFrame} from pull_fundamentals()

    Returns:
        dict of {ticker: monthly DataFrame} with standardized columns:
        [date, ev_ebitda, price_to_book, roic, gross_margin, revenue, data_source]
    """
    cleaned = {}

    REQUIRED_COLS = ['ev_ebitda', 'price_to_book', 'roic', 'gross_margin']

    for ticker, df in fundamentals_dict.items():
        if df is None or df.empty:
            cleaned[ticker] = pd.DataFrame()
            continue

        df = df.copy()

        # Parse date
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'], errors='coerce')
            df = df.dropna(subset=['date'])
        else:
            cleaned[ticker] = pd.DataFrame()
            continue

        # Ensure required columns exist
        for col in REQUIRED_COLS + ['revenue']:
            if col not in df.columns:
                df[col] = np.nan
            else:
                df[col] = pd.to_numeric(df[col], errors='coerce')

        # Sort and deduplicate by date
        df = df.sort_values('date').drop_duplicates(subset=['date'], keep='last')
        df = df.set_index('date')

        # Preserve data_source
        data_source = df['data_source'].iloc[-1] if 'data_source' in df.columns else 'unknown'

        # Apply shift(1) for look-ahead bias prevention:
        # Quarterly data is shifted one period forward before upsampling,
        # so Q1 data reported in April only enters the model in May.
        numeric_cols = [c for c in REQUIRED_COLS + ['revenue'] if c in df.columns]
        df_numeric = df[numeric_cols].shift(1)

        # Winsorize each column
        for col in numeric_cols:
            df_numeric[col] = _winsorize_series(df_numeric[col])

        # Upsample quarterly to monthly via forward-fill
        monthly_idx = pd.date_range(
            start=df_numeric.index.min(),
            end=pd.Timestamp.now().normalize(),
            freq='ME'
        )
        df_monthly = df_numeric.reindex(df_numeric.index.union(monthly_idx))
        df_monthly = df_monthly.sort_index().ffill(limit=6)
        df_monthly = df_monthly.reindex(monthly_idx)

        df_monthly['data_source'] = data_source
        df_monthly.index.name = 'date'
        df_monthly = df_monthly.reset_index()

        cleaned[ticker] = df_monthly

    return cleaned


def build_panel(prices_cad, fundamentals_clean, earnings_clean):
    """
    Merge prices, fundamentals, and earnings into a long-format panel DataFrame.

    Args:
        prices_cad: cleaned monthly CAD price DataFrame (date x ticker)
        fundamentals_clean: dict of {ticker: monthly fundamental DataFrame}
        earnings_clean: dict of {ticker: earnings DataFrame}

    Returns:
        Long-format panel DataFrame indexed by (date, ticker) with columns:
        [date, ticker, sector, listing_type, company_name, adj_close_cad,
         ev_ebitda, price_to_book, roic, gross_margin, revenue,
         eps_surprise, eps_growth_yoy, data_source]

    Side effects:
        Saves panel to data/processed/panel.csv
    """
    prices_long = prices_cad.reset_index().melt(
        id_vars=['Date'],
        var_name='ticker',
        value_name='adj_close_cad'
    ).rename(columns={'Date': 'date'})
    prices_long['date'] = pd.to_datetime(prices_long['date'])

    fund_frames = []
    for ticker, df in fundamentals_clean.items():
        if df is not None and not df.empty and 'date' in df.columns:
            df = df.copy()
            df['ticker'] = ticker
            fund_frames.append(df)

    earn_frames = []
    for ticker, df in earnings_clean.items():
        if df is not None and not df.empty and 'date' in df.columns:
            df = df.copy()
            df['ticker'] = ticker
            # Map to month-end
            df['date'] = pd.to_datetime(df['date']) + pd.offsets.MonthEnd(0)
            cols = ['date', 'ticker', 'eps_surprise_pct', 'eps_growth_yoy']
            cols = [c for c in cols if c in df.columns]
            earn_frames.append(df[cols])

    # Merge fundamentals
    if fund_frames:
        fund_panel = pd.concat(fund_frames, ignore_index=True)
        fund_panel['date'] = pd.to_datetime(fund_panel['date']) + pd.offsets.MonthEnd(0)
        panel = prices_long.merge(fund_panel, on=['date', 'ticker'], how='left')
    else:
        panel = prices_long.copy()
        for col in ['ev_ebitda', 'price_to_book', 'roic', 'gross_margin', 'revenue']:
            panel[col] = np.nan
        panel['data_source'] = 'none'

    # Merge earnings
    if earn_frames:
        earn_panel = pd.concat(earn_frames, ignore_index=True)
        earn_panel = earn_panel.drop_duplicates(subset=['date', 'ticker'], keep='last')
        panel = panel.merge(earn_panel, on=['date', 'ticker'], how='left')
    else:
        panel['eps_surprise_pct'] = np.nan
        panel['eps_growth_yoy'] = np.nan

    # Add metadata
    panel['sector'] = panel['ticker'].map(SECTORS).fillna('Unknown')
    panel['listing_type'] = panel['ticker'].map(LISTING_TYPE).fillna('Unknown')
    panel['company_name'] = panel['ticker'].map(COMPANY_NAMES).fillna(panel['ticker'])

    if 'data_source' not in panel.columns:
        panel['data_source'] = 'none'

    # Standardize column order
    col_order = [
        'date', 'ticker', 'company_name', 'sector', 'listing_type',
        'adj_close_cad', 'ev_ebitda', 'price_to_book', 'roic', 'gross_margin',
        'revenue', 'eps_surprise_pct', 'eps_growth_yoy', 'data_source'
    ]
    col_order = [c for c in col_order if c in panel.columns]
    panel = panel[col_order]

    # Filter to universe tickers only
    panel = panel[panel['ticker'].isin(UNIVERSE)]

    # Sort
    panel = panel.sort_values(['date', 'ticker']).reset_index(drop=True)

    # Diagnostics
    n_rows = len(panel)
    date_min = panel['date'].min()
    date_max = panel['date'].max()
    missing_pct = panel[['ev_ebitda', 'price_to_book', 'roic', 'gross_margin']].isna().mean() * 100
    full_history = panel.groupby('ticker')['adj_close_cad'].count()
    max_months = full_history.max()
    n_full = (full_history >= max_months * 0.8).sum()

    print(f"\nPanel built: {n_rows:,} rows | {date_min.strftime('%Y-%m')} to {date_max.strftime('%Y-%m')}")
    print(f"  Tickers with >80% history: {n_full}/{panel['ticker'].nunique()}")
    print("  Missing % per fundamental column:")
    for col, pct in missing_pct.items():
        print(f"    {col}: {pct:.1f}%")

    panel.to_csv(PROCESSED_DIR / 'panel.csv', index=False)
    print(f"  Saved panel.csv ({n_rows:,} rows)")

    return panel
