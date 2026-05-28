"""
src/backtest.py — Backtesting module for Odlum Brown Factor Model.

Computes quintile returns, Information Coefficients, factor decay,
stress test performance, and showcase examples. All returns in CAD.
"""

from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import TRANSACTION_COST_BPS

BACKTEST_DIR = Path(__file__).parent.parent / 'data' / 'processed' / 'backtest_results'
BACKTEST_DIR.mkdir(parents=True, exist_ok=True)


def _forward_return(prices_wide, months=1):
    """
    Compute forward return over `months` periods from a wide price DataFrame.

    Args:
        prices_wide: DataFrame (date x ticker) of CAD prices
        months: lookahead horizon in months

    Returns:
        DataFrame of same shape with forward returns
    """
    fwd = prices_wide.shift(-months) / prices_wide - 1
    return fwd


def quintile_backtest(panel, factor_col, forward_months=None):
    """
    Monthly quintile sort and equal-weight portfolio forward returns.

    Sorts universe into 5 quintiles each month by factor_col, computes
    equal-weight average forward return for each quintile across horizons.

    Args:
        panel: long-format panel DataFrame with factor and price columns
        factor_col: column name of the factor to sort on
        forward_months: list of forward horizons to evaluate (default [1,3,6,12])

    Returns:
        dict with keys:
          'summary': DataFrame (quintile x horizon) of avg forward returns
          'monthly': DataFrame of monthly Q1 and Q5 returns at 1-month horizon
    """
    if forward_months is None:
        forward_months = [1, 3, 6, 12]

    prices_wide = panel.pivot_table(index='date', columns='ticker', values='adj_close_cad')
    prices_wide = prices_wide.sort_index()

    dates = sorted(panel['date'].unique())
    quintile_returns = {h: {q: [] for q in range(1, 6)} for h in forward_months}
    monthly_q1 = []
    monthly_q5 = []

    for date in dates:
        cross = panel[panel['date'] == date][['ticker', factor_col]].dropna()
        if len(cross) < 10:
            continue

        cross['quintile'] = pd.qcut(cross[factor_col], 5, labels=[1, 2, 3, 4, 5])

        for h in forward_months:
            fwd = _forward_return(prices_wide, h)
            if date not in fwd.index:
                continue
            fwd_at_date = fwd.loc[date]

            for q in range(1, 6):
                q_tickers = cross[cross['quintile'] == q]['ticker'].tolist()
                q_rets = fwd_at_date[q_tickers].dropna()
                if not q_rets.empty:
                    quintile_returns[h][q].append(q_rets.mean())

            if h == 1:
                q1 = cross[cross['quintile'] == 1]['ticker'].tolist()
                q5 = cross[cross['quintile'] == 5]['ticker'].tolist()
                r1 = fwd_at_date[q1].dropna().mean() if q1 else np.nan
                r5 = fwd_at_date[q5].dropna().mean() if q5 else np.nan
                monthly_q1.append({'date': date, 'q1_return': r1})
                monthly_q5.append({'date': date, 'q5_return': r5})

    summary_data = {}
    for h in forward_months:
        col_data = {}
        for q in range(1, 6):
            rets = quintile_returns[h][q]
            col_data[f'Q{q}'] = np.mean(rets) * 100 if rets else np.nan
        summary_data[f'{h}M'] = col_data

    summary = pd.DataFrame(summary_data)

    monthly_df = pd.DataFrame(monthly_q1).merge(
        pd.DataFrame(monthly_q5), on='date', how='outer'
    ).sort_values('date')

    return {'summary': summary, 'monthly': monthly_df}


def calc_information_coefficient(panel, factor_col, forward_month=1):
    """
    Compute Spearman Information Coefficient between factor scores and forward returns.

    Args:
        panel: long-format panel DataFrame
        factor_col: column name of the factor
        forward_month: forward return horizon in months

    Returns:
        dict with keys: ic_series, mean_ic, ic_std, ic_ir, hit_rate
    """
    prices_wide = panel.pivot_table(index='date', columns='ticker', values='adj_close_cad')
    prices_wide = prices_wide.sort_index()
    fwd_rets = _forward_return(prices_wide, forward_month)

    ic_values = []
    dates = sorted(panel['date'].unique())

    for date in dates:
        cross = panel[panel['date'] == date][['ticker', factor_col]].dropna()
        if len(cross) < 10 or date not in fwd_rets.index:
            continue

        fwd_at_date = fwd_rets.loc[date, cross['ticker']].dropna()
        cross_filtered = cross[cross['ticker'].isin(fwd_at_date.index)]

        if len(cross_filtered) < 10:
            continue

        factor_vals = cross_filtered.set_index('ticker')[factor_col]
        aligned_fwd = fwd_at_date.reindex(factor_vals.index).dropna()
        factor_aligned = factor_vals.reindex(aligned_fwd.index)

        if len(aligned_fwd) < 10:
            continue

        ic, _ = stats.spearmanr(factor_aligned, aligned_fwd)
        ic_values.append({'date': date, 'ic': ic})

    if not ic_values:
        return {
            'ic_series': pd.DataFrame(),
            'mean_ic': np.nan,
            'ic_std': np.nan,
            'ic_ir': np.nan,
            'hit_rate': np.nan,
        }

    ic_series = pd.DataFrame(ic_values).set_index('date')['ic']
    mean_ic = ic_series.mean()
    ic_std = ic_series.std()
    ic_ir = mean_ic / ic_std if ic_std > 0 else np.nan
    hit_rate = (ic_series > 0).mean()

    return {
        'ic_series': ic_series,
        'mean_ic': mean_ic,
        'ic_std': ic_std,
        'ic_ir': ic_ir,
        'hit_rate': hit_rate,
    }


def calc_factor_decay(panel, factor_col, max_horizon=12):
    """
    Compute IC at each horizon 1 through max_horizon to assess signal decay.

    Args:
        panel: long-format panel DataFrame
        factor_col: factor column name
        max_horizon: maximum months to evaluate

    Returns:
        DataFrame with columns [horizon, mean_ic, ic_ir] indexed by horizon
    """
    results = []
    for h in range(1, max_horizon + 1):
        ic_stats = calc_information_coefficient(panel, factor_col, forward_month=h)
        results.append({
            'horizon': h,
            'mean_ic': ic_stats['mean_ic'],
            'ic_ir': ic_stats['ic_ir'],
        })
    return pd.DataFrame(results).set_index('horizon')


def apply_transaction_costs(returns_series, avg_turnover_pct, cost_bps=TRANSACTION_COST_BPS):
    """
    Subtract round-trip transaction costs from a return series.

    Args:
        returns_series: pd.Series of periodic gross returns
        avg_turnover_pct: average monthly portfolio turnover as decimal (e.g., 0.30)
        cost_bps: round-trip cost in basis points (default 15)

    Returns:
        pd.Series of net returns after transaction costs
    """
    cost_per_period = avg_turnover_pct * cost_bps / 10000
    return returns_series - cost_per_period


def stress_test_periods(panel, factor_col):
    """
    Compute Q1-Q5 spread return over three specific stress periods.

    Periods:
        Oil crash:  2014-07-01 to 2016-06-30
        COVID:      2020-01-01 to 2020-12-31
        Rate shock: 2022-01-01 to 2023-06-30

    Args:
        panel: long-format panel DataFrame
        factor_col: factor column name

    Returns:
        DataFrame with columns [period, q1_avg, q5_avg, spread] for each period
        plus full-period baseline
    """
    periods = {
        'Full period': (panel['date'].min(), panel['date'].max()),
        'Oil crash (2014-2016)': (pd.Timestamp('2014-07-01'), pd.Timestamp('2016-06-30')),
        'COVID (2020)': (pd.Timestamp('2020-01-01'), pd.Timestamp('2020-12-31')),
        'Rate shock (2022-2023)': (pd.Timestamp('2022-01-01'), pd.Timestamp('2023-06-30')),
    }

    prices_wide = panel.pivot_table(index='date', columns='ticker', values='adj_close_cad')
    fwd_rets = _forward_return(prices_wide, 1)
    results = []

    for period_name, (start, end) in periods.items():
        period_panel = panel[(panel['date'] >= start) & (panel['date'] <= end)]
        q1_rets, q5_rets = [], []

        for date, grp in period_panel.groupby('date'):
            cross = grp[['ticker', factor_col]].dropna()
            if len(cross) < 10 or date not in fwd_rets.index:
                continue

            cross['quintile'] = pd.qcut(cross[factor_col], 5, labels=[1, 2, 3, 4, 5])
            fwd_at_date = fwd_rets.loc[date]

            q1_t = cross[cross['quintile'] == 1]['ticker'].tolist()
            q5_t = cross[cross['quintile'] == 5]['ticker'].tolist()

            r1 = fwd_at_date[q1_t].dropna().mean()
            r5 = fwd_at_date[q5_t].dropna().mean()

            if not np.isnan(r1):
                q1_rets.append(r1)
            if not np.isnan(r5):
                q5_rets.append(r5)

        q1_avg = np.mean(q1_rets) * 100 if q1_rets else np.nan
        q5_avg = np.mean(q5_rets) * 100 if q5_rets else np.nan
        spread = q1_avg - q5_avg if not np.isnan(q1_avg) and not np.isnan(q5_avg) else np.nan

        results.append({
            'period': period_name,
            'q1_avg_monthly_ret_%': round(q1_avg, 2) if not np.isnan(q1_avg) else None,
            'q5_avg_monthly_ret_%': round(q5_avg, 2) if not np.isnan(q5_avg) else None,
            'q1_minus_q5_spread_%': round(spread, 2) if spread is not None and not np.isnan(spread) else None,
        })

    return pd.DataFrame(results)


def find_showcase_examples(panel):
    """
    Find cases where composite_score fell below 30 and stock subsequently
    underperformed the universe by >10% over 6 months.

    Args:
        panel: long-format panel DataFrame with composite_score

    Returns:
        list of dicts with keys: ticker, date, composite_score, fwd_6m_return,
        universe_fwd_6m_return, underperformance
    """
    prices_wide = panel.pivot_table(index='date', columns='ticker', values='adj_close_cad')
    fwd_6m = _forward_return(prices_wide, 6)

    universe_avg_fwd = fwd_6m.mean(axis=1)
    low_score = panel[panel['composite_score'] < 30].copy()

    examples = []
    for _, row in low_score.iterrows():
        date = row['date']
        ticker = row['ticker']

        if date not in fwd_6m.index or ticker not in fwd_6m.columns:
            continue

        stock_ret = fwd_6m.loc[date, ticker]
        univ_ret = universe_avg_fwd.loc[date] if date in universe_avg_fwd.index else np.nan

        if np.isnan(stock_ret) or np.isnan(univ_ret):
            continue

        underperformance = stock_ret - univ_ret
        if underperformance < -0.10:
            examples.append({
                'ticker': ticker,
                'date': date,
                'composite_score': round(row['composite_score'], 1),
                'fwd_6m_return': round(stock_ret * 100, 1),
                'universe_fwd_6m_return': round(univ_ret * 100, 1),
                'underperformance': round(underperformance * 100, 1),
            })

    return examples[:3]  # Return top 3


def run_full_backtest(panel):
    """
    Run complete backtest suite for composite and all individual factors.

    Args:
        panel: enriched panel DataFrame from run_all_factors()

    Returns:
        dict with backtest results for all factors

    Side effects:
        Saves results to data/processed/backtest_results/
        Prints formatted summary table
    """
    print("\nRunning backtests...")

    factors = {
        'composite': 'composite_score',
        'value': 'factor_value',
        'quality': 'factor_quality',
        'momentum': 'factor_momentum',
        'revision': 'factor_revision',
    }

    results = {}

    for name, col in factors.items():
        if col not in panel.columns:
            print(f"  Skipping {name} — column not found")
            continue

        print(f"  Backtesting {name}...")

        # Quintile backtest
        qbt = quintile_backtest(panel, col, forward_months=[1, 3, 6, 12])

        # IC analysis
        ic_stats = calc_information_coefficient(panel, col, forward_month=1)

        # Factor decay
        decay = calc_factor_decay(panel, col, max_horizon=6)

        # Stress tests
        stress = stress_test_periods(panel, col)

        results[name] = {
            'quintile_backtest': qbt,
            'ic_stats': ic_stats,
            'factor_decay': decay,
            'stress_test': stress,
        }

        # Save
        qbt['summary'].to_csv(BACKTEST_DIR / f'{name}_quintile_returns.csv')
        if not ic_stats['ic_series'].empty:
            ic_stats['ic_series'].to_csv(BACKTEST_DIR / f'{name}_ic_series.csv')
        decay.to_csv(BACKTEST_DIR / f'{name}_factor_decay.csv')
        stress.to_csv(BACKTEST_DIR / f'{name}_stress_test.csv', index=False)

        # Also save monthly Q1/Q5 series for cumulative chart in dashboard
        if not qbt['monthly'].empty:
            qbt['monthly'].to_csv(BACKTEST_DIR / f'{name}_monthly_q1q5.csv', index=False)

    # Showcase examples
    examples = find_showcase_examples(panel)
    results['showcase_examples'] = examples

    # Print summary
    print("\n" + "=" * 60)
    print("BACKTEST SUMMARY")
    print("=" * 60)
    print(f"{'Factor':<15} {'Mean IC':>10} {'IC IR':>8} {'Hit Rate':>10} {'Q1-Q5 (1M)':>12}")
    print("-" * 60)
    for name, r in results.items():
        if name == 'showcase_examples':
            continue
        ic = r['ic_stats']
        qbt = r['quintile_backtest']['summary']

        mean_ic = f"{ic['mean_ic']:.3f}" if ic['mean_ic'] is not None and not np.isnan(ic['mean_ic']) else "N/A"
        ic_ir = f"{ic['ic_ir']:.2f}" if ic['ic_ir'] is not None and not np.isnan(ic['ic_ir']) else "N/A"
        hit_rate = f"{ic['hit_rate']*100:.0f}%" if ic['hit_rate'] is not None and not np.isnan(ic['hit_rate']) else "N/A"

        try:
            spread = qbt.loc['Q1', '1M'] - qbt.loc['Q5', '1M']
            spread_str = f"{spread:.2f}%"
        except Exception:
            spread_str = "N/A"

        print(f"  {name:<13} {mean_ic:>10} {ic_ir:>8} {hit_rate:>10} {spread_str:>12}")

    print("=" * 60)

    return results
