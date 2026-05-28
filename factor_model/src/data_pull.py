"""
src/data_pull.py — Data ingestion module for Odlum Brown Factor Model.

Pulls prices (yfinance), fundamentals (SimFin API v3 + Macrotrends fallback),
and earnings (yfinance). All price data converted to CAD before storage.
"""

import os
import re
import time
import json
import logging
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    UNIVERSE, TSX_TICKERS, US_TICKERS, SIMFIN_MARKET,
    MACROTRENDS_SLUGS, START_DATE
)

# Paths
DATA_DIR = Path(__file__).parent.parent / 'data'
RAW_PRICES_DIR = DATA_DIR / 'raw' / 'prices'
RAW_FUND_DIR = DATA_DIR / 'raw' / 'fundamentals'
RAW_EARN_DIR = DATA_DIR / 'raw' / 'earnings'
OUTPUTS_DIR = Path(__file__).parent.parent / 'outputs'

for d in [RAW_PRICES_DIR, RAW_FUND_DIR, RAW_EARN_DIR, OUTPUTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=OUTPUTS_DIR / 'error_log.txt',
    level=logging.ERROR,
    format='%(asctime)s | %(funcName)s | %(message)s'
)
logger = logging.getLogger(__name__)

SIMFIN_BASE = 'https://backend.simfin.com/api/v3'
SIMFIN_KEY = os.getenv('SIMFIN_API_KEY', '')


def _retry(func, *args, max_attempts=3, base_delay=1.0, **kwargs):
    """Retry a function up to max_attempts times with exponential backoff."""
    for attempt in range(max_attempts):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if attempt == max_attempts - 1:
                raise
            delay = base_delay * (2 ** attempt)
            time.sleep(delay)


def pull_prices(tickers=None, start=None, end=None):
    """
    Pull monthly adjusted close prices for all universe tickers via yfinance.
    Converts all USD-denominated prices to CAD using the CAD=X exchange rate.

    Args:
        tickers: list of canonical tickers (default: UNIVERSE)
        start: start date string (default: START_DATE)
        end: end date string (default: today)

    Returns:
        tuple: (prices_cad_df, prices_local_df) both indexed by month-end date,
               columns are canonical ticker names

    Side effects:
        Saves prices_monthly_cad.csv and prices_monthly_local.csv to data/raw/prices/
    """
    if tickers is None:
        tickers = UNIVERSE
    if start is None:
        start = START_DATE
    if end is None:
        end = datetime.today().strftime('%Y-%m-%d')

    # Build yfinance ticker map
    yf_map = {}  # canonical -> yfinance ticker
    for t in tickers:
        if t in TSX_TICKERS:
            yf_map[t] = TSX_TICKERS[t]
        else:
            yf_map[t] = t

    yf_tickers_list = list(yf_map.values()) + ['CAD=X']

    print(f"Pulling prices for {len(tickers)} tickers + USD/CAD rate...")

    try:
        raw = yf.download(
            yf_tickers_list,
            start=start,
            end=end,
            auto_adjust=True,
            progress=True,
        )
    except Exception as e:
        logger.error(f"yf.download failed: {e}")
        raise

    # Extract Close prices
    if isinstance(raw.columns, pd.MultiIndex):
        close = raw['Close']
    else:
        close = raw[['Close']]

    # Resample to month-end
    close_monthly = close.resample('ME').last()

    # Extract USD/CAD rate
    usdcad = close_monthly.get('CAD=X', pd.Series(dtype=float))
    if usdcad.empty or usdcad.isna().all():
        # Try alternate column access
        try:
            usdcad = close_monthly['CAD=X']
        except Exception:
            usdcad = pd.Series(1.35, index=close_monthly.index)
            logger.error("Could not pull CAD=X; using fixed 1.35 fallback")

    usdcad = usdcad.ffill().bfill()

    # Build local-currency price DataFrame (canonical column names)
    prices_local = pd.DataFrame(index=close_monthly.index)
    for canonical, yf_ticker in yf_map.items():
        if yf_ticker in close_monthly.columns:
            prices_local[canonical] = close_monthly[yf_ticker]
        else:
            logger.error(f"Ticker not found in download: {yf_ticker} ({canonical})")
            print(f"  WARNING: {canonical} ({yf_ticker}) not found in download")

    # Build CAD-converted price DataFrame
    prices_cad = prices_local.copy()
    for canonical in prices_cad.columns:
        if canonical not in TSX_TICKERS:
            # USD-denominated: multiply by USDCAD
            prices_cad[canonical] = prices_local[canonical] * usdcad

    # Drop any NaT index rows that can arise from resampling edge cases
    prices_local = prices_local[prices_local.index.notna()]
    prices_cad   = prices_cad[prices_cad.index.notna()]

    pulled = len(prices_local.columns)
    valid_idx = prices_local.index.dropna()
    date_min = valid_idx.min() if len(valid_idx) else pd.Timestamp('today')
    date_max = valid_idx.max() if len(valid_idx) else pd.Timestamp('today')
    print(f"Prices pulled: {pulled}/{len(tickers)} tickers. Date range: {date_min.strftime('%Y-%m')} to {date_max.strftime('%Y-%m')}")

    prices_local.to_csv(RAW_PRICES_DIR / 'prices_monthly_local.csv')
    prices_cad.to_csv(RAW_PRICES_DIR / 'prices_monthly_cad.csv')
    print(f"  Saved prices_monthly_local.csv and prices_monthly_cad.csv")

    return prices_cad, prices_local


def _pull_simfin_coverage():
    """Build set of tickers SimFin covers in us and ca markets."""
    if not SIMFIN_KEY:
        print("  SIMFIN_API_KEY not set — skipping SimFin")
        return set()

    headers = {'Authorization': SIMFIN_KEY}
    covered = set()

    for market in ['us', 'ca']:
        try:
            resp = _retry(
                requests.get,
                f"{SIMFIN_BASE}/companies/list",
                params={'market': market},
                headers=headers,
                timeout=30,
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    for item in data:
                        ticker = item.get('ticker', '')
                        if ticker:
                            covered.add(ticker.upper())
                elif isinstance(data, dict) and 'data' in data:
                    for row in data['data']:
                        covered.add(str(row[0]).upper())
        except Exception as e:
            logger.error(f"SimFin /companies/list market={market}: {e}")

    return covered


def _pull_simfin_ticker(ticker, market):
    """
    Pull quarterly fundamental statements from SimFin for one ticker.

    Args:
        ticker: canonical ticker
        market: 'us' or 'ca'

    Returns:
        DataFrame with fundamental data or None on failure
    """
    if not SIMFIN_KEY:
        return None

    headers = {'Authorization': SIMFIN_KEY}

    # Map canonical ticker to SimFin format (TSX tickers use .TO in SimFin)
    simfin_ticker = TSX_TICKERS.get(ticker, ticker)
    # SimFin may use hyphen instead of dot
    simfin_ticker = simfin_ticker.replace('.TO', '').replace('-', '.')

    try:
        resp = _retry(
            requests.get,
            f"{SIMFIN_BASE}/companies/statements/compact",
            params={
                'ticker': simfin_ticker,
                'statements': 'pl,bs,derived',
                'period': 'quarterly',
                'market': market,
            },
            headers=headers,
            timeout=30,
        )
        time.sleep(0.3)

        if resp.status_code == 429:
            time.sleep(10)
            return _pull_simfin_ticker(ticker, market)

        if resp.status_code != 200:
            return None

        data = resp.json()

        # Handle both list and dict responses
        if isinstance(data, list) and len(data) > 0:
            item = data[0]
        elif isinstance(data, dict):
            item = data
        else:
            return None

        # Parse columnsAndData format
        if 'columns' in item and 'data' in item:
            cols = item['columns']
            rows = item['data']
            df = pd.DataFrame(rows, columns=cols)
        elif 'statements' in item:
            dfs = []
            for stmt in item['statements']:
                if 'columns' in stmt and 'data' in stmt:
                    df_s = pd.DataFrame(stmt['data'], columns=stmt['columns'])
                    dfs.append(df_s)
            if dfs:
                df = dfs[0]
                for d in dfs[1:]:
                    shared_cols = [c for c in d.columns if c in df.columns]
                    df = df.merge(d.drop(columns=shared_cols[1:]), on=shared_cols[0], how='outer')
            else:
                return None
        else:
            return None

        return df

    except Exception as e:
        logger.error(f"SimFin pull failed for {ticker}: {e}")
        return None


def _parse_simfin_df(df, ticker):
    """
    Extract and standardize key fundamental fields from a SimFin DataFrame.

    Args:
        df: raw SimFin DataFrame
        ticker: canonical ticker for logging

    Returns:
        DataFrame with standardized columns or None
    """
    if df is None or df.empty:
        return None

    # Possible column name variants
    col_map = {
        'Date': ['Date', 'date', 'Report Date', 'Fiscal Year End'],
        'gross_margin': ['Gross Profit Margin', 'Gross Margin', 'gross_profit_margin'],
        'roic': ['Return On Inv. Capital', 'Return on Invested Capital', 'ROIC', 'roic'],
        'ev_ebitda': ['EV/EBITDA', 'Enterprise Value/EBITDA', 'ev_ebitda'],
        'price_to_book': ['Price to Book Value', 'Price/Book', 'P/B Ratio', 'price_to_book'],
        'revenue': ['Revenue', 'Total Revenue', 'Net Revenue', 'revenue'],
    }

    result = pd.DataFrame()

    # Find date column
    date_col = None
    for candidate in col_map['Date']:
        if candidate in df.columns:
            date_col = candidate
            break

    if date_col is None:
        return None

    result['date'] = pd.to_datetime(df[date_col], errors='coerce')

    for field, candidates in col_map.items():
        if field == 'Date':
            continue
        for candidate in candidates:
            if candidate in df.columns:
                result[field] = pd.to_numeric(df[candidate], errors='coerce')
                break
        if field not in result.columns:
            result[field] = np.nan

    result = result.dropna(subset=['date'])
    result = result.sort_values('date')
    result['ticker'] = ticker
    result['data_source'] = 'simfin'

    return result


def _scrape_macrotrends(ticker, metric):
    """
    Scrape a single metric for one ticker from Macrotrends.

    Args:
        ticker: canonical ticker
        metric: one of 'gross-profit-margin', 'price-book', 'ev-ebitda',
                'return-on-invested-capital'

    Returns:
        DataFrame with columns [date, value] or None
    """
    slug = MACROTRENDS_SLUGS.get(ticker)
    if not slug:
        return None

    url = f"https://www.macrotrends.net/stocks/charts/{slug}/{metric}"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }

    try:
        resp = _retry(requests.get, url, headers=headers, timeout=30)
        if resp.status_code != 200:
            return None

        match = re.search(r'var originalData = (\[.*?\]);', resp.text, re.DOTALL)
        if not match:
            return None

        raw_data = json.loads(match.group(1))
        records = []
        for item in raw_data:
            date_str = item.get('date', '')
            val_str = item.get('v', item.get('value', None))
            if date_str and val_str is not None:
                try:
                    records.append({'date': pd.to_datetime(date_str), 'value': float(val_str)})
                except (ValueError, TypeError):
                    pass

        if not records:
            return None

        return pd.DataFrame(records)

    except Exception as e:
        logger.error(f"Macrotrends scrape failed for {ticker} / {metric}: {e}")
        return None


def _pull_macrotrends_ticker(ticker):
    """
    Pull all fundamental metrics for one ticker from Macrotrends.

    Args:
        ticker: canonical ticker

    Returns:
        DataFrame with standardized fundamental columns or None
    """
    metrics = {
        'gross_margin': 'gross-profit-margin',
        'price_to_book': 'price-book',
        'ev_ebitda': 'ev-ebitda',
        'roic': 'return-on-invested-capital',
    }

    dfs = {}
    for field, metric_slug in metrics.items():
        df = _scrape_macrotrends(ticker, metric_slug)
        if df is not None and not df.empty:
            df = df.rename(columns={'value': field})
            dfs[field] = df.set_index('date')[field]

    if not dfs:
        return None

    result = pd.DataFrame(dfs)
    result.index.name = 'date'
    result = result.reset_index()
    result['ticker'] = ticker
    result['data_source'] = 'macrotrends'
    result['revenue'] = np.nan  # not scraped from Macrotrends

    return result


def pull_fundamentals(tickers=None):
    """
    Pull quarterly fundamental data for all tickers.

    Priority: SimFin API -> Macrotrends scraping -> mark as missing.

    Args:
        tickers: list of canonical tickers (default: UNIVERSE)

    Returns:
        dict mapping canonical ticker -> fundamental DataFrame

    Side effects:
        Saves per-ticker CSVs to data/raw/fundamentals/
        Prints coverage summary
    """
    if tickers is None:
        tickers = UNIVERSE

    print("\nPulling fundamental data...")

    # Get SimFin coverage
    simfin_covered = _pull_simfin_coverage()
    print(f"  SimFin covers {len(simfin_covered)} tickers across us/ca markets")

    results = {}
    simfin_count = 0
    macrotrends_count = 0
    missing_count = 0

    for ticker in tqdm(tickers, desc='Fundamentals'):
        market = SIMFIN_MARKET.get(ticker, 'us')
        df = None

        # Try SimFin first
        if SIMFIN_KEY:
            raw_df = _pull_simfin_ticker(ticker, market)
            if raw_df is not None and not raw_df.empty:
                df = _parse_simfin_df(raw_df, ticker)
                if df is not None and not df.empty:
                    simfin_count += 1

        # Fallback to Macrotrends
        if df is None or df.empty:
            df = _pull_macrotrends_ticker(ticker)
            if df is not None and not df.empty:
                macrotrends_count += 1

        if df is None or df.empty:
            missing_count += 1
            # Create empty placeholder
            df = pd.DataFrame({
                'date': pd.Series(dtype='datetime64[ns]'),
                'ticker': ticker,
                'data_source': 'none',
                'gross_margin': pd.Series(dtype=float),
                'roic': pd.Series(dtype=float),
                'ev_ebitda': pd.Series(dtype=float),
                'price_to_book': pd.Series(dtype=float),
                'revenue': pd.Series(dtype=float),
            })
            with open(OUTPUTS_DIR / 'error_log.txt', 'a') as f:
                f.write(f"{datetime.now().isoformat()} | pull_fundamentals | No fundamental data for {ticker}\n")

        results[ticker] = df
        if not df.empty:
            df.to_csv(RAW_FUND_DIR / f"{ticker.replace('.', '_').replace('/', '_')}_fundamentals.csv", index=False)

    print(f"Fundamentals — SimFin: {simfin_count} | Macrotrends: {macrotrends_count} | Missing: {missing_count}")
    return results


def pull_earnings(tickers=None):
    """
    Pull earnings history and compute EPS surprise and YoY EPS growth via yfinance.

    Args:
        tickers: list of canonical tickers (default: UNIVERSE)

    Returns:
        dict mapping canonical ticker -> earnings DataFrame with columns
        [date, eps_reported, eps_estimated, eps_surprise_pct, eps_growth_yoy]

    Side effects:
        Saves per-ticker CSVs to data/raw/earnings/
    """
    if tickers is None:
        tickers = UNIVERSE

    print("\nPulling earnings data...")
    results = {}

    for ticker in tqdm(tickers, desc='Earnings'):
        yf_ticker = TSX_TICKERS.get(ticker, ticker)

        try:
            stock = yf.Ticker(yf_ticker)

            # Try earnings history
            earnings_df = None
            try:
                # yfinance earnings
                hist = stock.earnings_history
                if hist is not None and not hist.empty:
                    hist = hist.reset_index()
                    # Standardize columns
                    date_col = [c for c in hist.columns if 'date' in c.lower() or 'quarter' in c.lower()]
                    if date_col:
                        hist['date'] = pd.to_datetime(hist[date_col[0]], errors='coerce')

                    reported_col = [c for c in hist.columns if 'reported' in c.lower() or 'actual' in c.lower()]
                    estimated_col = [c for c in hist.columns if 'estimate' in c.lower() or 'consensus' in c.lower()]

                    if reported_col and estimated_col:
                        hist['eps_reported'] = pd.to_numeric(hist[reported_col[0]], errors='coerce')
                        hist['eps_estimated'] = pd.to_numeric(hist[estimated_col[0]], errors='coerce')

                        denom = hist['eps_estimated'].abs()
                        denom = denom.where(denom > 0.01, np.nan)
                        hist['eps_surprise_pct'] = (hist['eps_reported'] - hist['eps_estimated']) / denom
                        hist['eps_surprise_pct'] = hist['eps_surprise_pct'].rolling(2).mean()
                        earnings_df = hist[['date', 'eps_reported', 'eps_estimated', 'eps_surprise_pct']].dropna(subset=['date'])
            except Exception:
                pass

            # Fallback: YoY EPS growth from income statement
            if earnings_df is None or earnings_df.empty:
                try:
                    income = stock.quarterly_income_stmt
                    if income is not None and not income.empty:
                        eps_row = None
                        for row_name in ['Basic EPS', 'Diluted EPS', 'EPS']:
                            if row_name in income.index:
                                eps_row = income.loc[row_name]
                                break

                        if eps_row is not None:
                            eps_series = eps_row.sort_index()
                            eps_yoy = eps_series.pct_change(4)
                            earnings_df = pd.DataFrame({
                                'date': pd.to_datetime(eps_series.index),
                                'eps_reported': eps_series.values,
                                'eps_estimated': np.nan,
                                'eps_surprise_pct': np.nan,
                                'eps_growth_yoy': eps_yoy.values,
                            })
                except Exception:
                    pass

            if earnings_df is None or earnings_df.empty:
                earnings_df = pd.DataFrame({
                    'date': pd.Series(dtype='datetime64[ns]'),
                    'eps_reported': pd.Series(dtype=float),
                    'eps_estimated': pd.Series(dtype=float),
                    'eps_surprise_pct': pd.Series(dtype=float),
                    'eps_growth_yoy': pd.Series(dtype=float),
                })

            if 'eps_growth_yoy' not in earnings_df.columns:
                earnings_df['eps_growth_yoy'] = np.nan

            earnings_df['ticker'] = ticker
            results[ticker] = earnings_df

            save_path = RAW_EARN_DIR / f"{ticker.replace('.', '_').replace('/', '_')}_earnings.csv"
            earnings_df.to_csv(save_path, index=False)

        except Exception as e:
            logger.error(f"Earnings pull failed for {ticker}: {e}")
            results[ticker] = pd.DataFrame()

    return results
