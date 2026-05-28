"""
dashboard/app.py — Streamlit dashboard for Odlum Brown Factor Scorecard.
"""

import sys
from pathlib import Path
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent.parent))

st.set_page_config(
    page_title="Odlum Brown — Factor Scorecard",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Data paths
ROOT = Path(__file__).parent.parent
OUTPUTS_DIR = ROOT / 'outputs'
FACTOR_DIR = ROOT / 'data' / 'processed' / 'factor_scores'
BACKTEST_DIR = ROOT / 'data' / 'processed' / 'backtest_results'


@st.cache_data(ttl=3600)
def load_scorecard():
    path = OUTPUTS_DIR / 'scorecard_CURRENT.csv'
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


@st.cache_data(ttl=3600)
def load_panel():
    path = FACTOR_DIR / 'panel_with_factors.csv'
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(path, parse_dates=['date'])
    return df


@st.cache_data(ttl=3600)
def load_ic_series(factor='composite'):
    path = BACKTEST_DIR / f'{factor}_ic_series.csv'
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, index_col=0, parse_dates=True)


@st.cache_data(ttl=3600)
def load_backtest_summary(factor='composite'):
    path = BACKTEST_DIR / f'{factor}_quintile_returns.csv'
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, index_col=0)


@st.cache_data(ttl=3600)
def load_stress_test(factor='composite'):
    path = BACKTEST_DIR / f'{factor}_stress_test.csv'
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


@st.cache_data(ttl=3600)
def load_factor_decay():
    frames = {}
    for f in ['composite', 'value', 'quality', 'momentum', 'revision']:
        path = BACKTEST_DIR / f'{f}_factor_decay.csv'
        if path.exists():
            frames[f] = pd.read_csv(path, index_col=0)
    return frames


def last_refresh():
    p = OUTPUTS_DIR / 'last_refresh.txt'
    if p.exists():
        return p.read_text().strip()
    return "Never"


def color_composite(val):
    if pd.isna(val):
        return ''
    if val >= 75:
        return 'background-color: #d4edda; color: #155724'
    elif val >= 50:
        return 'background-color: #fff3cd; color: #856404'
    else:
        return 'background-color: #f8d7da; color: #721c24'


def color_delta(val):
    if pd.isna(val):
        return ''
    return 'color: green; font-weight: bold' if val > 0 else 'color: red; font-weight: bold'


def format_flag(flag):
    if flag == 'Rising':
        return 'Rising'
    elif flag == 'Falling':
        return 'Falling'
    elif flag == 'Red flag':
        return 'Red flag'
    return ''


# ---- SIDEBAR ----
st.sidebar.title("Odlum Brown Factor Model")
st.sidebar.markdown("---")

scorecard = load_scorecard()
panel = load_panel()

if not scorecard.empty:
    all_sectors = sorted(scorecard['sector'].dropna().unique().tolist())
    selected_sectors = st.sidebar.multiselect("Sector", all_sectors, default=all_sectors)

    country_filter = st.sidebar.radio(
        "Listing",
        ["All", "Canada only (TSX)", "US & International only"],
        index=0,
    )

    min_score = st.sidebar.slider("Min Composite Score", 0, 100, 0)

    sort_by = st.sidebar.selectbox(
        "Sort by",
        ["Composite", "Value", "Quality", "Momentum", "Revision", "Delta Month"],
    )

    show_flagged = st.sidebar.toggle("Show flagged stocks only", value=False)

st.sidebar.markdown("---")
st.sidebar.markdown("**Refresh data:**")
st.sidebar.code("python run_all.py", language="bash")
st.sidebar.caption(f"Last refresh: {last_refresh()}")

# ---- MAIN TABS ----
tab1, tab2 = st.tabs(["Monthly Scorecard", "Backtest Results"])

# ==================== TAB 1 ====================
with tab1:
    if scorecard.empty:
        st.warning("No scorecard data found. Run `python run_all.py` first.")
    else:
        # Filter
        df = scorecard.copy()

        if selected_sectors:
            df = df[df['sector'].isin(selected_sectors)]

        if country_filter == "Canada only (TSX)":
            df = df[df['listing_type'] == 'TSX']
        elif country_filter == "US & International only":
            df = df[df['listing_type'] != 'TSX']

        df = df[df['composite_score'] >= min_score]

        if show_flagged:
            df = df[df['flag'].notna() & (df['flag'] != '')]

        sort_col_map = {
            "Composite": "composite_score",
            "Value": "factor_value",
            "Quality": "factor_quality",
            "Momentum": "factor_momentum",
            "Revision": "factor_revision",
            "Delta Month": "score_delta",
        }
        sort_col = sort_col_map[sort_by]
        df = df.sort_values(sort_col, ascending=False).reset_index(drop=True)
        df['rank'] = range(1, len(df) + 1)

        # Header
        latest_date = panel['date'].max().strftime('%B %Y') if not panel.empty else "Latest"
        st.markdown(f"## Odlum Brown Coverage - {latest_date} - {len(df)} stocks")

        # Metric row
        c1, c2, c3, c4 = st.columns(4)
        high_scorers = (df['composite_score'] >= 75).sum()
        avg_score = df['composite_score'].mean()

        top_mover = df.nlargest(1, 'score_delta')
        worst_faller = df.nsmallest(1, 'score_delta')

        c1.metric("Stocks >= 75", high_scorers)
        c2.metric("Avg Composite", f"{avg_score:.1f}")
        if not top_mover.empty:
            t = top_mover.iloc[0]
            delta_val = t['score_delta']
            if pd.notna(delta_val):
                c3.metric("Top Mover", f"{t['ticker']} +{delta_val:.0f}")
        if not worst_faller.empty:
            w = worst_faller.iloc[0]
            delta_val = w['score_delta']
            if pd.notna(delta_val):
                c4.metric("Worst Faller", f"{w['ticker']} {delta_val:.0f}")

        # Table display
        display_df = df[['rank', 'ticker', 'company_name', 'sector', 'listing_type',
                          'composite_score', 'factor_value', 'factor_quality',
                          'factor_momentum', 'factor_revision', 'score_delta', 'flag']].copy()
        display_df['flag'] = display_df['flag'].apply(format_flag)
        display_df.columns = ['Rank', 'Ticker', 'Company', 'Sector', 'Listed',
                               'Composite', 'Value', 'Quality', 'Momentum', 'Revision', 'Delta Month', 'Flag']

        styled = display_df.style.applymap(color_composite, subset=['Composite'])
        styled = styled.applymap(color_delta, subset=['Delta Month'])
        st.dataframe(styled, use_container_width=True, height=600)

        # ---- STOCK DETAIL ----
        st.markdown("---")
        st.subheader("Stock Detail")

        ticker_options = df['ticker'].tolist()
        if ticker_options:
            selected_ticker = st.selectbox("Select a stock", ticker_options, index=0)
            stock_row = df[df['ticker'] == selected_ticker].iloc[0]

            col1, col2, col3, col4 = st.columns(4)
            col1.markdown(f"**{stock_row['company_name']}**")
            col2.markdown(f"Sector: **{stock_row['sector']}**")
            col3.markdown(f"Listed: **{stock_row['listing_type']}**")
            col4.markdown(f"Composite: **{stock_row['composite_score']:.1f}/100**")

            # Factor bars
            factor_vals = {
                'Value': stock_row['factor_value'],
                'Quality': stock_row['factor_quality'],
                'Momentum': stock_row['factor_momentum'],
                'Revision': stock_row['factor_revision'],
            }

            cols = st.columns(4)
            for i, (fname, fval) in enumerate(factor_vals.items()):
                with cols[i]:
                    bar_val = fval if pd.notna(fval) else 0
                    bar_color = '#28a745' if bar_val >= 60 else '#ffc107' if bar_val >= 40 else '#dc3545'
                    fig = go.Figure(go.Bar(
                        x=[bar_val],
                        y=[fname],
                        orientation='h',
                        marker_color=[bar_color],
                        text=[f"{fval:.1f}" if pd.notna(fval) else "N/A"],
                        textposition='auto',
                    ))
                    fig.update_layout(
                        title=fname, height=150,
                        xaxis=dict(range=[0, 100]),
                        margin=dict(l=10, r=10, t=30, b=10),
                    )
                    st.plotly_chart(fig, use_container_width=True)

            # Historical composite score chart
            if not panel.empty:
                ticker_hist = panel[panel['ticker'] == selected_ticker].sort_values('date')
                if not ticker_hist.empty:
                    fig_hist = px.line(
                        ticker_hist.tail(24), x='date', y='composite_score',
                        title=f"{selected_ticker} — 24-month Composite Score History",
                        labels={'date': '', 'composite_score': 'Composite Score'},
                    )
                    fig_hist.add_hline(y=75, line_dash="dash", line_color="green", annotation_text="75")
                    fig_hist.add_hline(y=50, line_dash="dash", line_color="orange", annotation_text="50")
                    fig_hist.add_hline(y=25, line_dash="dash", line_color="red", annotation_text="25")
                    fig_hist.update_layout(yaxis=dict(range=[0, 100]))
                    st.plotly_chart(fig_hist, use_container_width=True)

            if stock_row['listing_type'] != 'TSX':
                st.info("**Currency note:** Returns converted to CAD for cross-stock comparison using the USD/CAD spot rate.")

# ==================== TAB 2 ====================
with tab2:
    st.markdown("## Backtest Results")

    factor_opts = ['composite', 'value', 'quality', 'momentum', 'revision']
    sel_factor = st.selectbox("Factor", factor_opts, index=0)

    # Load data
    qbt = load_backtest_summary(sel_factor)
    ic_series_df = load_ic_series(sel_factor)
    stress_df = load_stress_test(sel_factor)
    decay_frames = load_factor_decay()

    if qbt.empty and ic_series_df.empty:
        st.warning("No backtest results found. Run `python run_all.py` first.")
    else:
        col_a, col_b = st.columns(2)

        # Cumulative returns chart
        with col_a:
            st.subheader("Cumulative Q1 vs Q5 vs Equal-Weight")

            monthly_q_path = BACKTEST_DIR / f'{sel_factor}_monthly_q1q5.csv'
            if monthly_q_path.exists():
                mq = pd.read_csv(monthly_q_path, parse_dates=['date'])
                fig_cum = go.Figure()
                for col, name, color in [('q1_return', 'Q1 (Best)', '#28a745'),
                                          ('q5_return', 'Q5 (Worst)', '#dc3545')]:
                    if col in mq.columns:
                        cum = (1 + mq[col].fillna(0)).cumprod() - 1
                        fig_cum.add_trace(go.Scatter(
                            x=mq['date'], y=cum * 100,
                            name=name, line=dict(color=color)
                        ))
                fig_cum.update_layout(
                    title="Cumulative Returns (%)", height=400,
                    yaxis_title="Cumulative Return (%)", xaxis_title=""
                )
                st.plotly_chart(fig_cum, use_container_width=True)
            elif not qbt.empty:
                st.dataframe(qbt, use_container_width=True)

        # IC time series
        with col_b:
            st.subheader("IC Time Series")
            if not ic_series_df.empty:
                fig_ic = go.Figure()
                fig_ic.add_trace(go.Scatter(
                    x=ic_series_df.index,
                    y=ic_series_df.iloc[:, 0],
                    name='Monthly IC',
                    line=dict(color='#007bff'),
                ))
                fig_ic.add_hline(y=0, line_color='black', line_dash='dash')
                mean_val = ic_series_df.iloc[:, 0].mean()
                fig_ic.add_hline(
                    y=mean_val,
                    line_color='red', line_dash='dot',
                    annotation_text=f"Mean IC: {mean_val:.3f}"
                )
                fig_ic.update_layout(title="Spearman IC vs. Forward 1M CAD Return", height=400)
                st.plotly_chart(fig_ic, use_container_width=True)
            else:
                st.info("IC data not yet available.")

        # Factor decay chart
        st.subheader("Factor Decay (IC vs Horizon)")
        if decay_frames:
            fig_decay = go.Figure()
            colors = {'composite': '#007bff', 'value': '#28a745', 'quality': '#fd7e14',
                      'momentum': '#6f42c1', 'revision': '#dc3545'}
            for fname, df_decay in decay_frames.items():
                if 'mean_ic' in df_decay.columns:
                    fig_decay.add_trace(go.Scatter(
                        x=df_decay.index,
                        y=df_decay['mean_ic'],
                        name=fname.capitalize(),
                        line=dict(color=colors.get(fname, '#999')),
                    ))
            fig_decay.add_hline(y=0, line_dash='dash', line_color='black')
            fig_decay.update_layout(
                title="Factor IC Decay by Horizon",
                xaxis_title="Horizon (months)",
                yaxis_title="Mean IC",
                height=400,
            )
            st.plotly_chart(fig_decay, use_container_width=True)

        # Stress test table
        st.subheader("Stress Test Results")
        if not stress_df.empty:
            st.dataframe(stress_df, use_container_width=True)

        # Summary stats table
        st.subheader("Summary Statistics by Factor")
        stats_rows = []
        for fname in factor_opts:
            ic_path = BACKTEST_DIR / f'{fname}_ic_series.csv'
            if ic_path.exists():
                ic_s = pd.read_csv(ic_path, index_col=0, parse_dates=True).iloc[:, 0]
                ic_std = ic_s.std()
                stats_rows.append({
                    'Factor': fname.capitalize(),
                    'Mean IC': f"{ic_s.mean():.3f}",
                    'IC Std': f"{ic_std:.3f}",
                    'IC IR': f"{ic_s.mean()/ic_std:.2f}" if ic_std > 0 else 'N/A',
                    'Hit Rate': f"{(ic_s > 0).mean()*100:.0f}%",
                    'Obs': len(ic_s),
                })
        if stats_rows:
            st.dataframe(pd.DataFrame(stats_rows), use_container_width=True)
