"""
generate_synthetic_data.py — Generates realistic synthetic historical data for all 46 tickers.

Used when live data APIs are unavailable. Produces sector-appropriate price histories,
fundamental ratios, and earnings surprises from 2014-01-01 to today.
All synthetic tickers are flagged with data_source='synthetic'.
"""

import sys
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from config import (
    UNIVERSE, SECTORS, TSX_TICKERS, US_TICKERS, START_DATE
)

SEED = 42
rng = np.random.default_rng(SEED)

# ── Sector-level fundamental priors (median ratios) ──────────────────────────
SECTOR_PRIORS = {
    'Financials':        dict(ev_ebitda=12.0, pb=1.6, roic=0.12, gross_margin=0.55, annual_ret=0.10),
    'Real Estate':       dict(ev_ebitda=20.0, pb=2.0, roic=0.08, gross_margin=0.60, annual_ret=0.09),
    'Materials':         dict(ev_ebitda=10.0, pb=1.8, roic=0.10, gross_margin=0.30, annual_ret=0.08),
    'Energy':            dict(ev_ebitda=8.0,  pb=1.4, roic=0.09, gross_margin=0.35, annual_ret=0.07),
    'Industrials':       dict(ev_ebitda=14.0, pb=3.0, roic=0.14, gross_margin=0.40, annual_ret=0.11),
    'Consumer Disc':     dict(ev_ebitda=22.0, pb=4.5, roic=0.15, gross_margin=0.45, annual_ret=0.12),
    'Info Tech':         dict(ev_ebitda=28.0, pb=8.0, roic=0.22, gross_margin=0.65, annual_ret=0.16),
    'Consumer Staples':  dict(ev_ebitda=16.0, pb=4.0, roic=0.18, gross_margin=0.50, annual_ret=0.10),
    'Comm Services':     dict(ev_ebitda=15.0, pb=3.5, roic=0.13, gross_margin=0.55, annual_ret=0.09),
    'Utilities':         dict(ev_ebitda=12.0, pb=1.5, roic=0.07, gross_margin=0.40, annual_ret=0.08),
    'Health Care':       dict(ev_ebitda=20.0, pb=4.0, roic=0.16, gross_margin=0.60, annual_ret=0.13),
}

# Big-name overrides: high-growth US names have rich valuations by design
TICKER_OVERRIDES = {
    'AAPL':  dict(ev_ebitda=28, pb=45,  roic=0.55, gross_margin=0.44),
    'MSFT':  dict(ev_ebitda=35, pb=12,  roic=0.30, gross_margin=0.70),
    'AMZN':  dict(ev_ebitda=40, pb=8,   roic=0.10, gross_margin=0.48),
    'GOOG':  dict(ev_ebitda=22, pb=6,   roic=0.20, gross_margin=0.57),
    'CSU':   dict(ev_ebitda=45, pb=20,  roic=0.18, gross_margin=0.35),
    'TDG':   dict(ev_ebitda=30, pb=None, roic=0.12, gross_margin=0.55),
    'MCO':   dict(ev_ebitda=28, pb=16,  roic=0.25, gross_margin=0.65),
    'V':     dict(ev_ebitda=25, pb=13,  roic=0.35, gross_margin=0.80),
    'PGR':   dict(ev_ebitda=18, pb=4,   roic=0.15, gross_margin=0.25),
}

DATA_DIR = ROOT / 'data'
RAW_PRICES_DIR  = DATA_DIR / 'raw' / 'prices'
RAW_FUND_DIR    = DATA_DIR / 'raw' / 'fundamentals'
RAW_EARN_DIR    = DATA_DIR / 'raw' / 'earnings'
PROC_DIR        = DATA_DIR / 'processed'

for d in [RAW_PRICES_DIR, RAW_FUND_DIR, RAW_EARN_DIR, PROC_DIR]:
    d.mkdir(parents=True, exist_ok=True)


def _monthly_dates(start='2014-01-01'):
    return pd.date_range(start=start, end=pd.Timestamp.now(), freq='ME')


def generate_prices():
    """
    Generate realistic monthly price histories for all 46 tickers.
    Uses correlated GBM with sector drift and individual noise.
    Returns (prices_cad_df, prices_local_df).
    """
    dates = _monthly_dates()
    n = len(dates)

    # USDCAD path: random walk around 1.35
    usdcad_log_returns = rng.normal(0, 0.015, n)
    usdcad = 1.27 * np.exp(np.cumsum(usdcad_log_returns))
    usdcad = np.clip(usdcad, 1.15, 1.55)
    usdcad_series = pd.Series(usdcad, index=dates)

    # Market common factor
    market_ret = rng.normal(0.007, 0.04, n)

    prices_local = pd.DataFrame(index=dates)
    prices_cad   = pd.DataFrame(index=dates)
    prices_cad['__usdcad__'] = usdcad_series  # keep for reference

    for ticker in UNIVERSE:
        sector = SECTORS.get(ticker, 'Financials')
        prior  = SECTOR_PRIORS.get(sector, SECTOR_PRIORS['Financials'])
        monthly_drift = prior['annual_ret'] / 12
        vol = rng.uniform(0.02, 0.045)
        beta = rng.uniform(0.7, 1.3)

        idio = rng.normal(0, vol, n)
        log_rets = monthly_drift + beta * market_ret * 0.3 + idio
        start_price = rng.uniform(20, 200)
        prices = start_price * np.exp(np.cumsum(log_rets))

        prices_local[ticker] = prices

        if ticker in TSX_TICKERS:
            prices_cad[ticker] = prices
        else:
            prices_cad[ticker] = prices * usdcad

    prices_cad = prices_cad.drop(columns=['__usdcad__'])

    prices_local.to_csv(RAW_PRICES_DIR / 'prices_monthly_local.csv')
    prices_cad.to_csv(RAW_PRICES_DIR / 'prices_monthly_cad.csv')
    print(f"Synthetic prices: {len(UNIVERSE)} tickers × {n} months ({dates[0].strftime('%Y-%m')} – {dates[-1].strftime('%Y-%m')})")
    return prices_cad, prices_local


def _generate_ticker_fundamentals(ticker, sector, dates_quarterly):
    """Generate quarterly fundamental time series for one ticker."""
    prior = SECTOR_PRIORS.get(sector, SECTOR_PRIORS['Financials'])
    ovr   = TICKER_OVERRIDES.get(ticker, {})

    n = len(dates_quarterly)
    def _series(base, noise_scale=0.05, drift=0.001):
        vals = base + rng.normal(0, base * noise_scale, n)
        vals = vals * np.exp(np.cumsum(rng.normal(drift, 0.01, n)))
        return np.clip(vals, base * 0.3, base * 4)

    ev_ebitda    = _series(ovr.get('ev_ebitda', prior['ev_ebitda']), 0.12)
    roic         = _series(ovr.get('roic', prior['roic']), 0.10, 0.002)
    gross_margin = _series(ovr.get('gross_margin', prior['gross_margin']), 0.05)
    gross_margin = np.clip(gross_margin, 0.05, 0.95)

    pb_base = ovr.get('pb', prior['pb'])
    if pb_base is None:
        pb_base = -5.0  # negative book (TDG has negative book value)
    price_to_book = _series(pb_base, 0.15) if pb_base > 0 else np.full(n, pb_base)

    revenue_base = rng.uniform(1e9, 50e9)
    revenue = _series(revenue_base, 0.08, 0.005)

    return pd.DataFrame({
        'date':          dates_quarterly,
        'ev_ebitda':     ev_ebitda,
        'price_to_book': price_to_book,
        'roic':          roic,
        'gross_margin':  gross_margin,
        'revenue':       revenue,
        'ticker':        ticker,
        'data_source':   'synthetic',
    })


def generate_fundamentals():
    """Generate quarterly fundamentals for all 46 tickers and save CSVs."""
    dates_q = pd.date_range('2013-10-01', pd.Timestamp.now(), freq='QE')
    fundamentals = {}
    for ticker in UNIVERSE:
        sector = SECTORS.get(ticker, 'Financials')
        df = _generate_ticker_fundamentals(ticker, sector, dates_q)
        fname = ticker.replace('.', '_').replace('/', '_') + '_fundamentals.csv'
        df.to_csv(RAW_FUND_DIR / fname, index=False)
        fundamentals[ticker] = df
    print(f"Synthetic fundamentals: {len(UNIVERSE)} tickers × {len(dates_q)} quarters")
    return fundamentals


def generate_earnings():
    """Generate quarterly EPS surprise and YoY growth for all 46 tickers."""
    earnings = {}
    dates_q = pd.date_range('2013-10-01', pd.Timestamp.now(), freq='QE')
    n = len(dates_q)

    for ticker in UNIVERSE:
        sector = SECTORS.get(ticker, 'Financials')
        prior  = SECTOR_PRIORS.get(sector, SECTOR_PRIORS['Financials'])

        # EPS level with positive trend
        eps_base = rng.uniform(0.5, 8.0)
        eps_reported = eps_base * np.exp(np.cumsum(rng.normal(0.01, 0.08, n)))
        eps_reported = np.clip(eps_reported, -5, 100)

        # Analysts consistently under-estimate (positive surprise bias)
        surprise_pct = rng.normal(0.04, 0.12, n)
        eps_estimated = eps_reported / (1 + surprise_pct)
        rolling_surprise = pd.Series(surprise_pct).rolling(2, min_periods=1).mean().values

        yoy_growth = pd.Series(eps_reported).pct_change(4).values

        df = pd.DataFrame({
            'date':             dates_q,
            'eps_reported':     eps_reported,
            'eps_estimated':    eps_estimated,
            'eps_surprise_pct': rolling_surprise,
            'eps_growth_yoy':   yoy_growth,
            'ticker':           ticker,
        })

        fname = ticker.replace('.', '_').replace('/', '_') + '_earnings.csv'
        df.to_csv(RAW_EARN_DIR / fname, index=False)
        earnings[ticker] = df

    print(f"Synthetic earnings: {len(UNIVERSE)} tickers × {n} quarters")
    return earnings


if __name__ == '__main__':
    print("Generating synthetic data for all 46 tickers...")
    prices_cad, prices_local = generate_prices()
    fundamentals = generate_fundamentals()
    earnings = generate_earnings()
    print("Done. Run the pipeline next.")
