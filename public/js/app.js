/**
 * EarningsIQ — Frontend SPA
 *
 * A Quartr-inspired earnings intelligence dashboard.
 * Views: Watchlist | Calendar | Summaries | Search
 */

// ── Markdown renderer (basic) ──────────────────────────────────────────────────
function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    // Escape HTML entities first
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Headers
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$3</h3>'.replace('$3','$1'))
    // Bold & italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // HR
    .replace(/^---+$/gm, '<hr>')
    // Tables (basic — header + rows)
    .replace(/(\|.+\|\n)(\|[-| :]+\|\n)((\|.+\|\n?)*)/g, (match) => {
      const rows = match.trim().split('\n').filter(Boolean);
      const headerCols = rows[0].split('|').filter(s => s.trim());
      const header = '<tr>' + headerCols.map(c => `<th>${c.trim()}</th>`).join('') + '</tr>';
      const bodyRows = rows.slice(2).map(row => {
        const cols = row.split('|').filter(s => s.trim() !== undefined).slice(1, -1);
        return '<tr>' + cols.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
      }).join('');
      return `<table><thead>${header}</thead><tbody>${bodyRows}</tbody></table>`;
    })
    // Blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Line breaks → paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    ;

  // Wrap in paragraph tags if not already block elements
  return `<div class="md-content">${html}</div>`;
}

// ── API helpers ────────────────────────────────────────────────────────────────
const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(err.error || r.statusText);
    }
    return r.json();
  },
  async patch(path, body) {
    const r = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(err.error || r.statusText);
    }
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(err.error || r.statusText);
    }
    return r.json();
  },
  async text(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(r.statusText);
    return r.text();
  },
};

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  watchlist: [],
  summaries: [],
  quotes: {},
  selectedSummary: null,
  currentView: 'watchlist',
  searchTimeout: null,
};

// ── Toast ──────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── View Navigation ────────────────────────────────────────────────────────────
function showView(name) {
  state.currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById(`view-${name}`)?.classList.add('active');
  document.querySelector(`.nav-link[data-view="${name}"]`)?.classList.add('active');

  // Lazy-load data for each view
  if (name === 'watchlist') loadWatchlist();
  if (name === 'calendar')  loadCalendar();
  if (name === 'transcripts') loadSummaries();
  if (name === 'search') focusSearch();
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCHLIST VIEW
// ─────────────────────────────────────────────────────────────────────────────

async function loadWatchlist() {
  const grid = document.getElementById('watchlist-grid');
  grid.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>Loading watchlist…</span></div>`;

  try {
    state.watchlist = await api.get('/api/watchlist');
    renderWatchlistGrid();
    // Fetch live prices in background
    state.watchlist.forEach(c => fetchQuote(c.ticker));
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p>Failed to load watchlist: ${e.message}</p></div>`;
  }
}

async function fetchQuote(ticker) {
  try {
    const q = await api.get(`/api/quote/${ticker}`);
    if (q && q.price) {
      state.quotes[ticker] = q;
      // Update price cells in existing cards
      const card = document.querySelector(`.company-card[data-ticker="${ticker}"]`);
      if (card) updateCardPrice(card, ticker);
    }
  } catch (_) {}
}

function updateCardPrice(card, ticker) {
  const q = state.quotes[ticker];
  if (!q) return;

  const sign = q.changePct >= 0 ? '+' : '';
  const priceEl = card.querySelector('.card-price');
  const changeEl = card.querySelector('.card-change');

  if (priceEl) priceEl.textContent = `$${q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (changeEl) {
    changeEl.textContent = `${sign}${q.changePct.toFixed(2)}%`;
    changeEl.className = `card-change ${q.changePct >= 0 ? 'pos' : 'neg'}`;
  }
}

function renderWatchlistGrid() {
  const grid = document.getElementById('watchlist-grid');

  if (state.watchlist.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <p>Your watchlist is empty.<br>Add companies to start tracking earnings.</p>
        <button class="btn btn-primary" onclick="openAddModal()">Add Your First Company</button>
      </div>`;
    return;
  }

  grid.innerHTML = state.watchlist.map(company => renderCompanyCard(company)).join('');
}

function renderCompanyCard(company) {
  const q = state.quotes[company.ticker];
  const priceText = q
    ? `$${q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
  const changePct = q ? q.changePct : null;
  const changeText = q ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '';

  const hasSummary = company.lastProcessedDate;
  const statusHtml = company.enabled
    ? `<div class="status-pill active"><div class="status-pill-dot"></div>Active</div>`
    : `<div class="status-pill paused">Paused</div>`;

  const lastEventHtml = company.lastEventTitle
    ? `<div class="card-last-event">
        <div class="event-label">Last Processed</div>
        <div class="event-title">${escHtml(company.lastEventTitle)}</div>
        <div class="event-date">${company.lastProcessedDate}</div>
       </div>`
    : `<div class="card-last-event">
        <div class="event-label">Last Processed</div>
        <div class="event-title" style="color:var(--text-muted)">No summaries yet</div>
       </div>`;

  // Short ticker for avatar (max 4 chars)
  const av = company.ticker.slice(0, 4);

  return `
    <div class="company-card ${company.enabled ? '' : 'disabled'}" data-ticker="${company.ticker}">
      <div class="card-header">
        <div class="card-ticker-wrap">
          <div class="ticker-avatar">${av}</div>
          <div>
            <div class="card-ticker">${company.ticker}</div>
            <div class="card-name">${escHtml(company.name)}</div>
          </div>
        </div>
        <label class="card-toggle" title="${company.enabled ? 'Pause' : 'Enable'} monitoring">
          <input type="checkbox" class="toggle-input" data-ticker="${company.ticker}"
                 ${company.enabled ? 'checked' : ''} onchange="toggleCompany('${company.ticker}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="card-price-row">
        <span class="card-price">${priceText}</span>
        ${changeText ? `<span class="card-change ${changePct >= 0 ? 'pos' : 'neg'}">${changeText}</span>` : ''}
        ${statusHtml}
      </div>

      ${lastEventHtml}

      <div class="card-actions">
        <button class="btn btn-ghost" onclick="runEarnings('${company.ticker}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Run Now
        </button>
        ${hasSummary ? `
          <button class="btn btn-ghost" onclick="viewSummaryForTicker('${company.ticker}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            View
          </button>
        ` : ''}
        <button class="btn btn-danger" onclick="deleteCompany('${company.ticker}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

async function toggleCompany(ticker, enabled) {
  try {
    await api.patch(`/api/watchlist/${ticker}`, { enabled });
    const idx = state.watchlist.findIndex(c => c.ticker === ticker);
    if (idx !== -1) state.watchlist[idx].enabled = enabled;
    // Update card visual without full re-render
    const card = document.querySelector(`.company-card[data-ticker="${ticker}"]`);
    if (card) card.classList.toggle('disabled', !enabled);
    toast(`${ticker} ${enabled ? 'enabled' : 'paused'}`, enabled ? 'success' : 'info');
  } catch (e) {
    toast(`Failed: ${e.message}`, 'error');
    // Revert the checkbox
    const cb = document.querySelector(`.toggle-input[data-ticker="${ticker}"]`);
    if (cb) cb.checked = !enabled;
  }
}

async function deleteCompany(ticker) {
  if (!confirm(`Remove ${ticker} from watchlist?`)) return;
  try {
    await api.del(`/api/watchlist/${ticker}`);
    state.watchlist = state.watchlist.filter(c => c.ticker !== ticker);
    renderWatchlistGrid();
    toast(`${ticker} removed`, 'info');
  } catch (e) {
    toast(`Failed: ${e.message}`, 'error');
  }
}

function viewSummaryForTicker(ticker) {
  showView('transcripts');
  // After loading, select the most recent summary for this ticker
  state._pendingTickerFilter = ticker;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD COMPANY MODAL
// ─────────────────────────────────────────────────────────────────────────────

function openAddModal(prefill = {}) {
  document.getElementById('modal-ticker').value = prefill.ticker || '';
  document.getElementById('modal-name').value = prefill.name || '';
  document.getElementById('modal-add-error').classList.add('hidden');
  showModal('modal-add');
}

function closeAddModal() {
  closeModal();
}

async function confirmAdd() {
  const ticker = document.getElementById('modal-ticker').value.trim().toUpperCase();
  const name   = document.getElementById('modal-name').value.trim();
  const errEl  = document.getElementById('modal-add-error');

  if (!ticker || !name) {
    errEl.textContent = 'Both ticker and company name are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('btn-confirm-add');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  try {
    await api.post('/api/watchlist', { ticker, name });
    closeModal();
    toast(`${ticker} added to watchlist`, 'success');
    loadWatchlist();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add to Watchlist';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN EARNINGS MODAL (SSE log stream)
// ─────────────────────────────────────────────────────────────────────────────

function runEarnings(ticker) {
  const logEl  = document.getElementById('run-log');
  const title  = document.getElementById('run-modal-title');
  const closeBtn = document.getElementById('btn-close-run');
  const doneBtn  = document.getElementById('btn-run-done');

  logEl.innerHTML = '';
  title.textContent = `Running: ${ticker}`;
  closeBtn.disabled = true;
  doneBtn.classList.add('hidden');

  showModal('modal-run');

  const appendLog = (line) => {
    const div = document.createElement('div');
    div.textContent = line;
    // Colorize lines
    if (line.includes('✅') || line.includes('✉️')) div.className = 'log-line-success';
    else if (line.includes('❌') || line.includes('Error')) div.className = 'log-line-error';
    else if (line.includes('🚀') || line.includes('📅') || line.includes('🔎')) div.className = 'log-line-info';
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  };

  fetch(`/api/run/${ticker}`, { method: 'POST' })
    .then(resp => {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const read = () => reader.read().then(({ done, value }) => {
        if (done) {
          finishRun(ticker, closeBtn, doneBtn);
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // last incomplete chunk
        for (const part of parts) {
          if (!part.startsWith('data:')) continue;
          try {
            const ev = JSON.parse(part.slice(5).trim());
            if (ev.log) appendLog(ev.log);
            if (ev.done) {
              finishRun(ticker, closeBtn, doneBtn, ev.success);
              return;
            }
          } catch (_) {}
        }
        read();
      });
      read();
    })
    .catch(e => {
      appendLog(`❌ Connection error: ${e.message}`);
      finishRun(ticker, closeBtn, doneBtn, false);
    });
}

function finishRun(ticker, closeBtn, doneBtn, success) {
  closeBtn.disabled = false;
  doneBtn.classList.remove('hidden');
  if (success !== false) {
    loadWatchlist(); // refresh to show updated state
    loadSummaries();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR VIEW
// ─────────────────────────────────────────────────────────────────────────────

async function loadCalendar() {
  const content = document.getElementById('calendar-content');
  content.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>Fetching earnings dates…</span></div>`;

  try {
    const [calendarData, watchlist] = await Promise.all([
      api.get('/api/calendar'),
      api.get('/api/watchlist'),
    ]);
    renderCalendar(calendarData, watchlist);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load calendar: ${e.message}</p></div>`;
  }
}

function renderCalendar(data, watchlist) {
  const content = document.getElementById('calendar-content');
  const wlMap   = Object.fromEntries(watchlist.map(c => [c.ticker, c]));
  const today   = new Date().toISOString().split('T')[0];

  if (data.length === 0) {
    content.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <p>No upcoming earnings data found.<br>Make sure your watchlist has companies with <strong>Active</strong> status.</p>
    </div>`;
    return;
  }

  // Separate upcoming vs no-date
  const upcoming = data.filter(d => d.date && d.date > today);
  const noDate   = data.filter(d => !d.date);
  const past     = data.filter(d => d.date && d.date <= today);

  let html = '';

  if (upcoming.length > 0) {
    html += `<div class="calendar-group-title">📅 Upcoming</div>`;
    html += upcoming.map(d => renderCalendarRow(d, wlMap, 'upcoming')).join('');
  }

  if (past.length > 0) {
    html += `<div class="calendar-group-title" style="margin-top:24px">📋 Recent</div>`;
    html += past.slice(-5).reverse().map(d => renderCalendarRow(d, wlMap, 'past')).join('');
  }

  if (noDate.length > 0) {
    html += `<div class="calendar-group-title" style="margin-top:24px">❓ Date TBD</div>`;
    html += noDate.map(d => renderCalendarRow(d, wlMap, 'tbd')).join('');
  }

  content.innerHTML = html;
}

function renderCalendarRow(d, wlMap, type) {
  const company = wlMap[d.ticker] || { name: d.ticker };
  const dateLabel = d.date ? formatDate(d.date) : 'TBD';
  const dayLabel  = d.date ? getDayLabel(d.date) : '';

  const surpriseClass = d.lastEpsSurpriseRaw == null ? 'neutral' :
    d.lastEpsSurpriseRaw > 0 ? 'pos' : 'neg';
  const surpriseText = d.lastEpsSurprise
    ? `${d.lastEpsSurpriseRaw > 0 ? '+' : ''}${d.lastEpsSurprise}`
    : '—';

  const upcomingBadge = type === 'upcoming'
    ? `<span class="cal-upcoming-badge">${daysUntil(d.date)}</span>`
    : '';

  return `
    <div class="calendar-row">
      <div>
        <div class="cal-date">${dateLabel}</div>
        <div class="cal-date-sub">${dayLabel}</div>
      </div>
      <div>
        <div class="cal-ticker">${d.ticker}</div>
        <div class="cal-name">${escHtml(company.name)}</div>
      </div>
      <div class="cal-eps">
        <div class="cal-eps-label">EPS Est.</div>
        <div class="cal-eps-value">${d.epsEstimate || '—'}</div>
      </div>
      <div class="cal-eps">
        <div class="cal-eps-label">Last Actual</div>
        <div class="cal-eps-value">${d.lastActualEps || '—'}</div>
      </div>
      <div>
        ${d.lastEpsSurprise
          ? `<div class="cal-surprise ${surpriseClass}">${surpriseText}</div>`
          : upcomingBadge
        }
      </div>
    </div>
  `;
}

function formatDate(dateStr) {
  if (!dateStr) return 'TBD';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function daysUntil(dateStr) {
  const diff = (new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'Today';
  if (diff < 1) return 'Today';
  if (diff < 2) return 'Tomorrow';
  return `in ${Math.ceil(diff)}d`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARIES VIEW
// ─────────────────────────────────────────────────────────────────────────────

async function loadSummaries() {
  const listEl = document.getElementById('summaries-list');
  listEl.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>Loading…</span></div>`;

  try {
    state.summaries = await api.get('/api/summaries');
    renderSummariesList();

    // If triggered from watchlist "View" button, auto-select
    if (state._pendingTickerFilter) {
      const match = state.summaries.find(s => s.ticker === state._pendingTickerFilter);
      if (match) selectSummary(match);
      state._pendingTickerFilter = null;
    }
  } catch (e) {
    listEl.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:12px">Failed: ${e.message}</div>`;
  }
}

function renderSummariesList() {
  const listEl = document.getElementById('summaries-list');

  if (state.summaries.length === 0) {
    listEl.innerHTML = `
      <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12.5px;line-height:1.6">
        No summaries yet.<br>Run earnings check from Watchlist to generate one.
      </div>`;
    return;
  }

  listEl.innerHTML = state.summaries.map(s => {
    const active = state.selectedSummary?.file === s.file ? 'active' : '';
    const dateStr = new Date(s.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const displayTitle = s.base.replace(`${s.ticker}_`, '').replace(/_summary$/, '').replace(/_/g, ' ');
    return `
      <div class="summary-item ${active}" data-file="${s.file}" onclick="selectSummary(${JSON.stringify(s).replace(/"/g, '&quot;')})">
        <div class="summary-item-ticker">${s.ticker}</div>
        <div class="summary-item-title">${escHtml(displayTitle)}</div>
        <div class="summary-item-date">${dateStr}</div>
      </div>
    `;
  }).join('');
}

async function selectSummary(summary) {
  state.selectedSummary = summary;

  // Update active state in list
  document.querySelectorAll('.summary-item').forEach(el => {
    el.classList.toggle('active', el.dataset.file === summary.file);
  });

  // Show content area
  document.getElementById('summary-viewer-empty').classList.add('hidden');
  document.getElementById('summary-viewer-content').classList.remove('hidden');

  const bodyEl = document.getElementById('summary-body');
  bodyEl.innerHTML = `<div class="loading-spinner"><div class="spinner"></div></div>`;

  // Update meta
  document.getElementById('summary-ticker-badge').textContent = summary.ticker;
  const displayTitle = summary.base.replace(`${summary.ticker}_`, '').replace(/_summary$/, '').replace(/_/g, ' ');
  document.getElementById('summary-title-text').textContent = displayTitle;

  // PDF download link
  const pdfLink = document.getElementById('btn-download-pdf');
  pdfLink.href = `/api/summaries/${encodeURIComponent(summary.file)}/pdf`;

  try {
    const md = await api.text(`/api/summaries/${encodeURIComponent(summary.file)}`);
    bodyEl.innerHTML = renderMarkdown(md);
  } catch (e) {
    bodyEl.innerHTML = `<div style="color:var(--red);padding:16px">${e.message}</div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH VIEW
// ─────────────────────────────────────────────────────────────────────────────

function focusSearch() {
  setTimeout(() => document.getElementById('search-input')?.focus(), 50);
}

function handleSearch(value) {
  clearTimeout(state.searchTimeout);
  const q = value.trim();

  const resultsEl = document.getElementById('search-results');
  const spinnerEl = document.getElementById('search-spinner');

  if (q.length < 1) {
    resultsEl.innerHTML = '';
    return;
  }

  spinnerEl.classList.remove('hidden');
  state.searchTimeout = setTimeout(async () => {
    try {
      const results = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
      spinnerEl.classList.add('hidden');
      renderSearchResults(results);
    } catch (e) {
      spinnerEl.classList.add('hidden');
      resultsEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:16px">Search failed: ${e.message}</div>`;
    }
  }, 350);
}

function renderSearchResults(results) {
  const el = document.getElementById('search-results');
  const watchlistTickers = new Set(state.watchlist.map(c => c.ticker));

  if (results.length === 0) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:16px 0">No results found.</div>`;
    return;
  }

  el.innerHTML = results.map(r => {
    const inWatchlist = watchlistTickers.has(r.ticker);
    const av = r.ticker.slice(0, 4);
    return `
      <div class="search-result-card">
        <div class="result-left">
          <div class="result-avatar">${av}</div>
          <div>
            <div class="result-ticker">${r.ticker}</div>
            <div class="result-name">${escHtml(r.name)}</div>
            ${r.exchange ? `<div class="result-exchange">${r.exchange}</div>` : ''}
          </div>
        </div>
        <div>
          ${inWatchlist
            ? `<span class="result-in-watchlist">✓ In Watchlist</span>`
            : `<button class="btn btn-primary btn-sm" onclick="addFromSearch('${r.ticker}', '${escAttr(r.name)}')">+ Add</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

async function addFromSearch(ticker, name) {
  try {
    await api.post('/api/watchlist', { ticker, name });
    state.watchlist.push({ ticker, name, enabled: true, lastProcessedDate: null });
    // Re-render search results to show "In Watchlist"
    const q = document.getElementById('search-input').value;
    handleSearch(q);
    toast(`${ticker} added to watchlist`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL UTILS
// ─────────────────────────────────────────────────────────────────────────────

function showModal(id) {
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}

function closeModal() {
  document.getElementById('overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// API STATUS CHECK
// ─────────────────────────────────────────────────────────────────────────────

async function checkApiStatus() {
  const dot   = document.getElementById('api-dot');
  const label = document.getElementById('api-label');
  try {
    await api.get('/api/watchlist');
    dot.className   = 'status-dot green';
    label.textContent = 'Connected';
  } catch (_) {
    dot.className   = 'status-dot red';
    label.textContent = 'Disconnected';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

function initEventListeners() {
  // Sidebar nav
  document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showView(link.dataset.view);
    });
  });

  // Add company button
  document.getElementById('btn-add-company').addEventListener('click', openAddModal);

  // Add company modal
  document.getElementById('btn-close-add').addEventListener('click', closeAddModal);
  document.getElementById('btn-cancel-add').addEventListener('click', closeAddModal);
  document.getElementById('btn-confirm-add').addEventListener('click', confirmAdd);

  // Add on Enter in modal inputs
  document.getElementById('modal-ticker').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('modal-name').focus());
  document.getElementById('modal-name').addEventListener('keydown', e => e.key === 'Enter' && confirmAdd());

  // Run modal close
  document.getElementById('btn-close-run').addEventListener('click', closeModal);
  document.getElementById('btn-run-done').addEventListener('click', closeModal);

  // Overlay click to close modal
  document.getElementById('overlay').addEventListener('click', () => {
    // Don't close run modal while running
    if (!document.getElementById('btn-close-run').disabled) closeModal();
  });

  // Calendar refresh
  document.getElementById('btn-refresh-calendar').addEventListener('click', loadCalendar);

  // Search input
  document.getElementById('search-input').addEventListener('input', e => handleSearch(e.target.value));
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch(e.target.value);
  });

  // Global keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const runModalOpen = !document.getElementById('modal-run').classList.contains('hidden');
      if (runModalOpen && document.getElementById('btn-close-run').disabled) return;
      closeModal();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

function init() {
  initEventListeners();
  checkApiStatus();
  showView('watchlist');
  console.log('%cEarningsIQ loaded ✓', 'color:#3b82f6;font-weight:bold;font-size:14px');
}

document.addEventListener('DOMContentLoaded', init);
