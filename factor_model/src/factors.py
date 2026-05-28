"""
src/factors.py — Factor calculation module for Odlum Brown Factor Model.

Computes four quantitative factors: Value, Quality, Momentum, Revision.
Each factor is scored 0-100 within the universe for each month.
Applies sector neutralization where sector size permits.
"""

from pathlib import Path
import numpy as np
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    SECTORS, SMALL_SECTORS, FACTOR_WEIGHTS,
    MIN_SECTOR_SIZE_FOR_NEUTRALIZATION
)

FACTOR_SCORES_DIR = Path(__file__).parent.parent / 'data' / 'processed' / 'factor_scores'
FACTOR_SCORES_DIR.mkdir(parents=True, exist_ok=True)


def _zscore(series):
    """Compute z-score of a Series, returning NaN where std is 0."""
    mu = series.mean()
    sigma = series.std()
    if sigma == 0 or np.isnan(sigma):
        return series * np.nan
    return (series - mu) / sigma


def sector_neutralize(series, sectors_series, min_sector_size=MIN_SECTOR_SIZE_FOR_NEUTRALIZATION):
    """
    Sector-neutralize a factor series within one cross-section (one month).

    For sectors with >= min_sector_size stocks: subtract sector median, divide by sector std.
    For small sectors (< min_sector_size): apply universe-wide z-score instead.

    Args:
        series: pd.Series of factor values, indexed by ticker
        sectors_series: pd.Series of sector labels, same index
        min_sector_size: minimum number of stocks for sector-level neutralization

    Returns:
        pd.Series of neutralized z-scores, same index
    """
    result = pd.Series(np.nan, index=series.index)
    unique_sectors = sectors_series.dropna().unique()

    universe_zscore = _zscore(series)

    for sector in unique_sectors:
        mask = sectors_series == sector
        sector_vals = series[mask]
        valid = sector_vals.dropna()

        if len(valid) >= min_sector_size and sector not in SMALL_SECTORS:
            mu = valid.median()
            sigma = valid.std()
            if sigma > 0:
                result[mask] = (series[mask] - mu) / sigma
            else:
                result[mask] = 0.0
        else:
            # Small sector: use universe-wide z-score
            result[mask] = universe_zscore[mask]

    return result


def _rank_0_100(series):
    """Rank a Series to 0-100 percentile scale (higher = better)."""
    return series.rank(pct=True, na_option='keep') * 100


def calc_value_factor(panel):
    """
    Compute the Value factor from EV/EBITDA and Price-to-Book.

    Lower multiples = better value, so both metrics are inverted before scoring.
    High-growth US names (AAPL, AMZN, MSFT, GOOG) will structurally score low
    on value; this is expected and correct behavior.

    Args:
        panel: long-format panel DataFrame with columns [date, ticker, sector,
               ev_ebitda, price_to_book]

    Returns:
        panel with added column 'factor_value'
    """
    panel = panel.copy()
    panel['factor_value'] = np.nan

    for date, grp in panel.groupby('date'):
        idx = grp.index
        sectors = grp['ticker'].map(SECTORS).fillna('Unknown')

        # Invert so lower multiple = higher score
        ev_ebitda_inv = -grp['ev_ebitda']
        pb_inv = -grp['price_to_book']

        # Sector-neutralize each component
        ev_z = sector_neutralize(ev_ebitda_inv, sectors)
        pb_z = sector_neutralize(pb_inv, sectors)

        # Average available components
        combined = pd.DataFrame({'ev': ev_z, 'pb': pb_z}, index=idx)
        avg = combined.mean(axis=1, skipna=True)

        # Rank 0-100
        panel.loc[idx, 'factor_value'] = _rank_0_100(avg)

    return panel


def calc_quality_factor(panel):
    """
    Compute the Quality factor from ROIC and gross margin trend.

    Gross margin trend is the 4-quarter (4-month in the monthly panel) rolling slope.
    Both components are sector-neutralized before averaging.

    Args:
        panel: long-format panel DataFrame with columns [date, ticker, sector,
               roic, gross_margin]

    Returns:
        panel with added column 'factor_quality'
    """
    panel = panel.copy()
    panel['factor_quality'] = np.nan

    # Compute gross margin 4-period slope per ticker
    def _rolling_slope(s, window=4):
        """Linear slope of last `window` observations."""
        def _slope(x):
            if x.isna().sum() > window // 2:
                return np.nan
            x_clean = x.dropna()
            if len(x_clean) < 2:
                return np.nan
            n = len(x_clean)
            xi = np.arange(n)
            slope = np.polyfit(xi, x_clean.values, 1)[0]
            return slope
        return s.rolling(window, min_periods=2).apply(_slope, raw=False)

    # Compute per-ticker gross margin trend
    gm_trend = (
        panel.sort_values(['ticker', 'date'])
        .groupby('ticker')['gross_margin']
        .transform(lambda s: _rolling_slope(s))
    )
    panel['_gm_trend'] = gm_trend

    for date, grp in panel.groupby('date'):
        idx = grp.index
        sectors = grp['ticker'].map(SECTORS).fillna('Unknown')

        roic_z = sector_neutralize(grp['roic'], sectors)
        gm_z = sector_neutralize(grp['_gm_trend'], sectors)

        combined = pd.DataFrame({'roic': roic_z, 'gm': gm_z}, index=idx)
        avg = combined.mean(axis=1, skipna=True)

        panel.loc[idx, 'factor_quality'] = _rank_0_100(avg)

    panel = panel.drop(columns=['_gm_trend'])
    return panel


def calc_momentum_factor(panel):
    """
    Compute the 12-1 month price momentum factor using CAD-converted prices.

    Uses 12-month return minus the most recent month (skip-month convention)
    to avoid short-term reversal contamination. Applied universe-wide (not
    sector-neutral) as momentum is most powerful as a cross-sectional signal.

    Requires minimum 10 months of price history.

    Args:
        panel: long-format panel DataFrame with columns [date, ticker, adj_close_cad]

    Returns:
        panel with added column 'factor_momentum'
    """
    panel = panel.copy()
    panel['factor_momentum'] = np.nan

    # Pivot to wide format for efficient rolling computation
    prices_wide = panel.pivot_table(index='date', columns='ticker', values='adj_close_cad')
    prices_wide = prices_wide.sort_index()

    # 12-1 month momentum: return from t-12 to t-1
    ret_12 = prices_wide.pct_change(12)   # 12-month return
    ret_1 = prices_wide.pct_change(1)     # 1-month return
    momentum = ret_12 - ret_1             # Skip-month momentum

    # Count valid months per ticker per date
    valid_months = prices_wide.notna().rolling(12, min_periods=10).sum()

    for date in prices_wide.index:
        if date not in panel['date'].values:
            continue
        idx = panel[panel['date'] == date].index
        tickers_at_date = panel.loc[idx, 'ticker']

        mom_vals = momentum.loc[date, tickers_at_date] if date in momentum.index else pd.Series(dtype=float)
        valid = valid_months.loc[date, tickers_at_date] if date in valid_months.index else pd.Series(dtype=float)

        # Mask tickers with insufficient history
        mom_vals = mom_vals.where(valid >= 10, np.nan)

        ranked = _rank_0_100(mom_vals)
        panel.loc[idx, 'factor_momentum'] = panel.loc[idx, 'ticker'].map(ranked).values

    return panel


def calc_revision_factor(panel):
    """
    Compute the Earnings Revision factor from EPS surprise or YoY EPS growth.

    Primary: rolling 2-quarter average EPS surprise percentage.
    Fallback: YoY EPS growth rate if surprise data unavailable.
    Applied universe-wide (not sector-neutral).

    Args:
        panel: long-format panel DataFrame with columns [date, ticker,
               eps_surprise_pct, eps_growth_yoy]

    Returns:
        panel with added column 'factor_revision'
    """
    panel = panel.copy()
    panel['factor_revision'] = np.nan

    # Use eps_surprise as primary; fall back to eps_growth_yoy
    revision_raw = panel['eps_surprise_pct'].copy()
    fallback_mask = revision_raw.isna() & panel['eps_growth_yoy'].notna()
    revision_raw[fallback_mask] = panel.loc[fallback_mask, 'eps_growth_yoy']

    panel['_revision_raw'] = revision_raw
    panel['_revision_smooth'] = (
        panel.sort_values(['ticker', 'date'])
        .groupby('ticker')['_revision_raw']
        .transform(lambda s: s.rolling(2, min_periods=1).mean())
    )

    for date, grp in panel.groupby('date'):
        idx = grp.index
        panel.loc[idx, 'factor_revision'] = _rank_0_100(grp['_revision_smooth'])

    panel = panel.drop(columns=['_revision_raw', '_revision_smooth'])
    return panel


def calc_composite_score(panel, weights=None):
    """
    Compute weighted composite factor score scaled to 0-100, plus momentum flags.

    Methodology: z-score each factor within each month, take weighted average,
    then percentile-rank to 0-100. This ensures scores are always interpretable
    as a percentile within the current universe.

    Flags:
        'Rising'   if score_delta >= +8
        'Falling'  if score_delta <= -8
        'Red flag' if composite_score < 25 AND score_delta < -5
        ''         otherwise

    Args:
        panel: panel DataFrame with factor_value, factor_quality, factor_momentum,
               factor_revision columns
        weights: dict of {factor_name: weight}, defaults to FACTOR_WEIGHTS

    Returns:
        panel with added columns: composite_score, score_delta, flag
    """
    if weights is None:
        from config import FACTOR_WEIGHTS
        weights = FACTOR_WEIGHTS

    panel = panel.copy()
    panel['composite_score'] = np.nan

    factor_cols = {
        'value': 'factor_value',
        'quality': 'factor_quality',
        'momentum': 'factor_momentum',
        'revision': 'factor_revision',
    }

    for date, grp in panel.groupby('date'):
        idx = grp.index
        weighted_sum = pd.Series(0.0, index=idx)
        total_weight = pd.Series(0.0, index=idx)

        for factor_key, col in factor_cols.items():
            if col not in grp.columns:
                continue
            w = weights.get(factor_key, 0.25)
            z = _zscore(grp[col])
            valid_mask = z.notna()
            weighted_sum[valid_mask] += w * z[valid_mask]
            total_weight[valid_mask] += w

        # Normalize by actual weight (handle missing factors gracefully)
        composite = weighted_sum / total_weight.replace(0, np.nan)
        panel.loc[idx, 'composite_score'] = _rank_0_100(composite)

    # Month-over-month delta
    panel = panel.sort_values(['ticker', 'date'])
    panel['score_delta'] = panel.groupby('ticker')['composite_score'].diff()

    # Assign flags
    def _flag(row):
        if row['composite_score'] < 25 and row['score_delta'] < -5:
            return 'Red flag'
        elif row['score_delta'] >= 8:
            return 'Rising'
        elif row['score_delta'] <= -8:
            return 'Falling'
        return ''

    panel['flag'] = panel.apply(_flag, axis=1)

    return panel


def run_all_factors(panel):
    """
    Orchestrate all factor calculations on the panel DataFrame.

    Args:
        panel: long-format panel DataFrame from build_panel()

    Returns:
        Enriched panel DataFrame with all factor columns added

    Side effects:
        Saves panel_with_factors.csv to data/processed/factor_scores/
        Prints factor summary table
    """
    print("\nCalculating factors...")

    print("  Computing Value factor...")
    panel = calc_value_factor(panel)

    print("  Computing Quality factor...")
    panel = calc_quality_factor(panel)

    print("  Computing Momentum factor...")
    panel = calc_momentum_factor(panel)

    print("  Computing Revision factor...")
    panel = calc_revision_factor(panel)

    print("  Computing Composite score...")
    panel = calc_composite_score(panel)

    # Print factor summary
    factor_cols = ['factor_value', 'factor_quality', 'factor_momentum', 'factor_revision', 'composite_score']
    print("\nFactor Summary (latest month):")
    latest = panel[panel['date'] == panel['date'].max()]
    print(f"  {'Factor':<20} {'Mean':>8} {'Std':>8} {'Non-null%':>10}")
    for col in factor_cols:
        if col in latest.columns:
            vals = latest[col].dropna()
            print(f"  {col:<20} {vals.mean():>8.1f} {vals.std():>8.1f} {len(vals)/len(latest)*100:>9.1f}%")

    out_path = FACTOR_SCORES_DIR / 'panel_with_factors.csv'
    panel.to_csv(out_path, index=False)
    print(f"\n  Saved panel_with_factors.csv")

    return panel
