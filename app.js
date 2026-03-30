/* ── FinFeed App ─────────────────────────────────────────────────────────── */

// ── STATE ────────────────────────────────────────────────────────────────────
const state = {
  currentUser: {
    id: 'u0',
    username: 'yourhandle',
    displayName: 'Your Name',
    initials: 'YN',
    stats: {
      portfolioValue: 84320,
      netWorthGrowth: 18.4,
      monthlySavings: 2800,
      savingsGoal: 3500,
      positions: 12,
    },
  },
  posts: [
    {
      id: 'p1',
      authorId: 'u1',
      authorName: 'NvidiaNoah',
      authorInitials: 'NN',
      authorColor: '#7c3aed',
      type: 'stock-pick',
      tickers: ['NVDA', 'AMD'],
      body: 'Loaded up on $NVDA before earnings. The AI supercycle is nowhere near done. Data center revenue up 427% YoY. Sold covered calls to reduce my cost basis while I hold. Long-term target: $1,200.',
      likes: 312,
      comments: [
        { author: 'CryptoCarla', initials: 'CC', color: '#0891b2', text: 'Agreed! NVDA is printing money right now.', time: '1h ago' },
        { author: 'IndexFundIan', initials: 'II', color: '#059669', text: 'Brave holding through earnings. Good luck!', time: '45m ago' },
      ],
      timestamp: '2h ago',
      sparklineData: [420, 435, 428, 460, 452, 480, 512, 498, 540, 562],
    },
    {
      id: 'p2',
      authorId: 'u2',
      authorName: 'PortfolioPatricia',
      authorInitials: 'PP',
      authorColor: '#0891b2',
      type: 'portfolio-update',
      tickers: ['META', 'AMZN', 'GOOGL'],
      body: 'Q1 recap: portfolio up 22% YTD 🎉\n\nTop winners:\n• $META +61% — Year of Efficiency was real\n• $AMZN +28% — AWS re-acceleration\n• $GOOGL +18% — Gemini hype\n\nOne regret: sold $NVDA too early. Lesson learned — let your winners run!',
      likes: 189,
      comments: [
        { author: 'NvidiaNoah', initials: 'NN', color: '#7c3aed', text: 'Solid quarter! META has been a beast.', time: '3h ago' },
      ],
      timestamp: '4h ago',
      sparklineData: [100, 104, 108, 106, 112, 118, 115, 120, 119, 122],
    },
    {
      id: 'p3',
      authorId: 'u3',
      authorName: 'BudgetBabe',
      authorInitials: 'BB',
      authorColor: '#d97706',
      type: 'budget-tip',
      tickers: [],
      body: 'The 50/30/20 rule changed my financial life. Here\'s how I apply it on a $85k salary:\n\n50% → Needs ($3,541): rent, groceries, utilities\n30% → Wants ($2,125): dining, travel, fun\n20% → Savings ($1,416): 401k, index funds, emergency fund\n\nKey insight: automate the 20% on payday. You can\'t spend what you never see. 3 years in, I now have a 6-month emergency fund and $42k invested.',
      likes: 445,
      comments: [
        { author: 'IndexFundIan', initials: 'II', color: '#059669', text: 'Automation is the secret weapon. Great post!', time: '5h ago' },
        { author: 'DividendDave', initials: 'DD', color: '#b45309', text: 'I do 60/20/20 personally. The extra 10% to savings makes a huge difference over time.', time: '4h ago' },
        { author: 'PortfolioPatricia', initials: 'PP', color: '#0891b2', text: 'Saved this immediately. Thank you!', time: '2h ago' },
      ],
      timestamp: '6h ago',
      sparklineData: null,
    },
    {
      id: 'p4',
      authorId: 'u4',
      authorName: 'MillennialMilestone',
      authorInitials: 'MM',
      authorColor: '#db2777',
      type: 'milestone',
      tickers: ['VOO', 'VTI'],
      body: '🏆 HIT $100,000 NET WORTH AT 27!\n\nTook 4 years of consistent investing. Breakdown:\n• $62k in index funds ($VOO, $VTI)\n• $24k in 401k\n• $14k emergency fund\n\nStarted at $0 with $30k in student debt. Paid off the debt first, then went all in on investing. The first $100k is the hardest. Now I understand the snowball effect. Next stop: $250k!',
      likes: 1204,
      comments: [
        { author: 'BudgetBabe', initials: 'BB', color: '#d97706', text: 'THIS is so inspiring! Congratulations!! 🎉', time: '8h ago' },
        { author: 'NvidiaNoah', initials: 'NN', color: '#7c3aed', text: 'The first 100k really is the hardest. It gets easier from here, trust me!', time: '7h ago' },
      ],
      timestamp: '10h ago',
      sparklineData: null,
    },
    {
      id: 'p5',
      authorId: 'u5',
      authorName: 'CryptoCarla',
      authorInitials: 'CC',
      authorColor: '#0e7490',
      type: 'crypto',
      tickers: ['BTC', 'ETH'],
      body: '$BTC just broke above $72,000 resistance with strong volume. Here\'s my thesis for $80k:\n\n1. ETF inflows still accelerating (~$500M/day)\n2. Halving supply shock kicking in (new supply cut in half)\n3. Institutional adoption — BlackRock, Fidelity, now even pension funds\n4. Macro tailwinds: rate cuts = risk-on\n\nNot financial advice. I hold 15% of my portfolio in crypto — sized so I can sleep at night.',
      likes: 567,
      comments: [
        { author: 'IndexFundIan', initials: 'II', color: '#059669', text: 'Interesting thesis. Still too volatile for me personally but I respect the conviction.', time: '11h ago' },
      ],
      timestamp: '12h ago',
      sparklineData: [58000, 62000, 60000, 65000, 63000, 68000, 71000, 69000, 72000, 73500],
    },
  ],
  likedPosts: new Set(),
  savedPosts: new Set(),
  followedUsers: new Set(),
  activeCommentPostId: null,
  activeModal: null,
  marketData: [
    { symbol: 'S&P 500', short: 'SPX',   value: '5,218', changeRaw: 0.84,  positive: true  },
    { symbol: 'NASDAQ',  short: 'NDX',   value: '18,421', changeRaw: 1.12, positive: true  },
    { symbol: 'Bitcoin', short: 'BTC',   value: '$73.2k', changeRaw: 2.31, positive: true  },
    { symbol: 'Ethereum',short: 'ETH',   value: '$3,842', changeRaw: 1.87, positive: true  },
    { symbol: 'Gold',    short: 'GOLD',  value: '$2,318', changeRaw: -0.21,positive: false },
    { symbol: 'Oil WTI', short: 'OIL',   value: '$79.4',  changeRaw: -0.65,positive: false },
    { symbol: 'USD/EUR', short: 'FX',    value: '1.0812', changeRaw: 0.08, positive: true  },
  ],
  trendingTickers: [
    { symbol: 'NVDA',    name: 'NVIDIA Corp',        change: '+3.42%', positive: true  },
    { symbol: 'AAPL',    name: 'Apple Inc',          change: '+0.87%', positive: true  },
    { symbol: 'TSLA',    name: 'Tesla Inc',          change: '-2.13%', positive: false },
    { symbol: 'BTC-USD', name: 'Bitcoin',            change: '+2.31%', positive: true  },
    { symbol: 'META',    name: 'Meta Platforms',     change: '+1.54%', positive: true  },
    { symbol: 'AMZN',    name: 'Amazon.com Inc',     change: '+0.63%', positive: true  },
  ],
  suggestedUsers: [
    { id: 'su1', name: 'DividendDave',   handle: '@dividenddave',   initials: 'DD', color: '#b45309', bio: 'Dividend investor' },
    { id: 'su2', name: 'IndexFundIan',   handle: '@indexfundian',   initials: 'II', color: '#059669', bio: 'Passive investing' },
    { id: 'su3', name: 'CryptoCarla',    handle: '@cryptocarla',    initials: 'CC', color: '#0e7490', bio: 'BTC & ETH maxi' },
    { id: 'su4', name: 'BudgetBabe',     handle: '@budgetbabe',     initials: 'BB', color: '#d97706', bio: 'Personal finance' },
  ],
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fmt(n) { return new Intl.NumberFormat('en-US').format(n); }

function typeLabel(type) {
  const labels = {
    'stock-pick':       '📈 Stock Pick',
    'portfolio-update': '💼 Portfolio',
    'budget-tip':       '💡 Budget Tip',
    'milestone':        '🏆 Milestone',
    'crypto':           '₿ Crypto',
  };
  return labels[type] || type;
}

function avatarColors(seed) {
  const colors = ['#7c3aed','#0891b2','#d97706','#db2777','#059669','#0e7490','#b45309','#dc2626','#4f46e5'];
  let hash = 0;
  for (let c of seed) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

// ── SPARKLINE CANVAS ──────────────────────────────────────────────────────────
function drawSparkline(canvas, data) {
  if (!canvas || !data || data.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  const pad = 4;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const xStep = (w - pad * 2) / (data.length - 1);
  const yOf = v => pad + (1 - (v - min) / range) * (h - pad * 2);

  // gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(16,185,129,0.25)');
  grad.addColorStop(1, 'rgba(16,185,129,0)');
  ctx.beginPath();
  data.forEach((v, i) => i === 0 ? ctx.moveTo(pad, yOf(v)) : ctx.lineTo(pad + i * xStep, yOf(v)));
  ctx.lineTo(pad + (data.length - 1) * xStep, h);
  ctx.lineTo(pad, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  data.forEach((v, i) => i === 0 ? ctx.moveTo(pad, yOf(v)) : ctx.lineTo(pad + i * xStep, yOf(v)));
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // dot at end
  const lastX = pad + (data.length - 1) * xStep;
  const lastY = yOf(data[data.length - 1]);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#10b981';
  ctx.fill();
}

// ── RENDER: STORIES ───────────────────────────────────────────────────────────
function renderStories() {
  const bar = document.getElementById('stories-bar');
  bar.innerHTML = state.marketData.map(m => `
    <div class="story-pill">
      <div class="story-ring ${m.positive ? '' : 'negative'}">
        <div class="story-inner">
          <span class="s-symbol">${m.short}</span>
          <span class="s-change ${m.positive ? 'pos' : 'neg'}">${m.positive ? '+' : ''}${m.changeRaw.toFixed(2)}%</span>
        </div>
      </div>
      <div class="story-label">${m.symbol}</div>
    </div>
  `).join('');
}

// ── RENDER: TRENDING TICKERS ──────────────────────────────────────────────────
function renderTrendingTickers() {
  const el = document.getElementById('trending-tickers');
  el.innerHTML = state.trendingTickers.map(t => `
    <div class="ticker-row">
      <span class="ticker-symbol">${t.symbol}</span>
      <span class="ticker-name">${t.name}</span>
      <span class="ticker-change ${t.positive ? 'pos' : 'neg'}">${t.change}</span>
    </div>
  `).join('');
}

// ── RENDER: SUGGESTED USERS ───────────────────────────────────────────────────
function renderSuggestedUsers() {
  const el = document.getElementById('suggested-users');
  el.innerHTML = state.suggestedUsers.map(u => `
    <div class="suggested-user-row">
      <div class="sug-avatar" style="background:${u.color}">${u.initials}</div>
      <div class="sug-info">
        <div class="sug-name">${u.name}</div>
        <div class="sug-handle">${u.bio}</div>
      </div>
      <button class="sug-follow-btn ${state.followedUsers.has(u.id) ? 'following' : ''}"
              data-action="follow-sug" data-user-id="${u.id}">
        ${state.followedUsers.has(u.id) ? 'Following' : 'Follow'}
      </button>
    </div>
  `).join('');
}

// ── RENDER: SINGLE POST CARD ──────────────────────────────────────────────────
function renderPostCard(post) {
  const liked   = state.likedPosts.has(post.id);
  const saved   = state.savedPosts.has(post.id);
  const followed = state.followedUsers.has(post.authorId);

  const tickerHtml = post.tickers.length
    ? `<div class="post-tickers">${post.tickers.map(t => `<span class="ticker-tag">$${t}</span>`).join('')}</div>`
    : '';

  const sparkHtml = post.sparklineData
    ? `<div class="post-sparkline-wrap"><canvas data-post-id="${post.id}" class="sparkline-canvas" height="60"></canvas></div>`
    : '';

  const shownComments = post.comments.slice(0, 2);
  const commentsHtml = shownComments.map(c => `
    <div class="comment-line"><strong>${c.author}</strong>${c.text}</div>
  `).join('');
  const moreHtml = post.comments.length > 2
    ? `<div class="view-all-comments" data-action="open-comments" data-post-id="${post.id}">View all ${post.comments.length} comments</div>`
    : '';

  return `
    <article class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        <div class="post-avatar" style="background:${post.authorColor}">${post.authorInitials}</div>
        <div class="post-author-info">
          <div class="post-author-name">${post.authorName}</div>
          <div class="post-meta">
            <span class="post-type-badge badge-${post.type}">${typeLabel(post.type)}</span>
            <span class="post-timestamp">${post.timestamp}</span>
          </div>
        </div>
        ${post.authorId !== state.currentUser.id ? `
          <button class="post-follow-btn ${followed ? 'following' : ''}"
                  data-action="follow" data-user-id="${post.authorId}">
            ${followed ? 'Following' : 'Follow'}
          </button>
        ` : ''}
      </div>
      ${tickerHtml}
      <div class="post-body">${post.body.replace(/\n/g, '<br>')}</div>
      ${sparkHtml}
      <div class="post-actions">
        <button class="action-btn ${liked ? 'liked' : ''}" data-action="like" data-post-id="${post.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <span class="like-count">${fmt(post.likes + (liked ? 1 : 0))}</span>
        </button>
        <button class="action-btn" data-action="open-comments" data-post-id="${post.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>${post.comments.length}</span>
        </button>
        <button class="action-btn" data-action="share" data-post-id="${post.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
        <div class="action-spacer"></div>
        <button class="action-btn ${saved ? 'saved' : ''}" data-action="save" data-post-id="${post.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>
      <div class="post-stats">${fmt(post.likes + (liked ? 1 : 0))} likes</div>
      ${post.comments.length ? `
        <div class="post-comments-preview">
          ${commentsHtml}
          ${moreHtml}
        </div>
      ` : ''}
    </article>
  `;
}

// ── RENDER: FEED ──────────────────────────────────────────────────────────────
function renderFeed() {
  const feed = document.getElementById('feed');
  feed.innerHTML = state.posts.map(renderPostCard).join('');
  // Draw sparklines after DOM insert
  document.querySelectorAll('.sparkline-canvas').forEach(canvas => {
    const post = state.posts.find(p => p.id === canvas.dataset.postId);
    if (post?.sparklineData) {
      requestAnimationFrame(() => drawSparkline(canvas, post.sparklineData));
    }
  });
}

// ── ACTIONS ───────────────────────────────────────────────────────────────────
function handleLike(postId) {
  if (state.likedPosts.has(postId)) {
    state.likedPosts.delete(postId);
  } else {
    state.likedPosts.add(postId);
  }
  // Targeted DOM update (faster than full re-render)
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;
  const post  = state.posts.find(p => p.id === postId);
  const liked = state.likedPosts.has(postId);
  const btn   = card.querySelector('[data-action="like"]');
  const count = post.likes + (liked ? 1 : 0);
  btn.classList.toggle('liked', liked);
  btn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
  btn.querySelector('.like-count').textContent = fmt(count);
  card.querySelector('.post-stats').textContent = `${fmt(count)} likes`;
}

function handleSave(postId) {
  if (state.savedPosts.has(postId)) {
    state.savedPosts.delete(postId);
  } else {
    state.savedPosts.add(postId);
  }
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;
  const saved = state.savedPosts.has(postId);
  const btn = card.querySelector('[data-action="save"]');
  btn.classList.toggle('saved', saved);
  btn.querySelector('svg').setAttribute('fill', saved ? 'currentColor' : 'none');
}

function handleFollow(userId) {
  if (state.followedUsers.has(userId)) {
    state.followedUsers.delete(userId);
  } else {
    state.followedUsers.add(userId);
  }
  // Update all follow buttons for this user
  document.querySelectorAll(`[data-action="follow"][data-user-id="${userId}"]`).forEach(btn => {
    const f = state.followedUsers.has(userId);
    btn.classList.toggle('following', f);
    btn.textContent = f ? 'Following' : 'Follow';
  });
}

function handleFollowSug(userId) {
  handleFollow(userId);
  renderSuggestedUsers();
  attachSuggestedFollowListeners();
}

function handleShare(postId) {
  const post = state.posts.find(p => p.id === postId);
  const text = `Check out this post by ${post.authorName} on FinFeed`;
  if (navigator.share) {
    navigator.share({ title: 'FinFeed Post', text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showToast('Link copied to clipboard!');
    });
  }
}

// ── COMMENTS MODAL ────────────────────────────────────────────────────────────
function openCommentsModal(postId) {
  state.activeCommentPostId = postId;
  state.activeModal = 'comment';
  const post = state.posts.find(p => p.id === postId);
  const list = document.getElementById('comments-list');
  list.innerHTML = post.comments.map(c => `
    <div class="comment-item">
      <div class="comment-item-avatar" style="background:${c.color || avatarColors(c.author)}">${c.initials}</div>
      <div class="comment-item-body">
        <div class="comment-item-author">${c.author}</div>
        <div class="comment-item-text">${c.text}</div>
        <div class="comment-item-time">${c.time}</div>
      </div>
    </div>
  `).join('') || '<p style="color:var(--gray-400);font-size:0.85rem;">No comments yet. Be the first!</p>';
  showModal('comment-modal');
}

function submitComment() {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text || !state.activeCommentPostId) return;
  const post = state.posts.find(p => p.id === state.activeCommentPostId);
  const newComment = {
    author: state.currentUser.displayName,
    initials: state.currentUser.initials,
    color: '#10b981',
    text,
    time: 'Just now',
  };
  post.comments.push(newComment);
  input.value = '';
  openCommentsModal(state.activeCommentPostId);
  // Update comment count in feed card
  const card = document.querySelector(`.post-card[data-post-id="${state.activeCommentPostId}"]`);
  if (card) {
    card.querySelectorAll('[data-action="open-comments"] span').forEach(s => {
      s.textContent = post.comments.length;
    });
  }
}

// ── CREATE POST MODAL ─────────────────────────────────────────────────────────
function openCreateModal() {
  state.activeModal = 'create';
  document.getElementById('post-body-input').value = '';
  document.getElementById('ticker-input').value = '';
  document.getElementById('char-count').textContent = '0 / 280';
  showModal('create-modal');
}

function submitPost() {
  const body = document.getElementById('post-body-input').value.trim();
  if (!body) return;
  const type = document.getElementById('post-type-select').value;
  const rawTickers = document.getElementById('ticker-input').value;
  const tickers = rawTickers.split(/[,\s]+/).map(t => t.replace(/\$/g, '').toUpperCase()).filter(Boolean);

  const newPost = {
    id: 'p' + Date.now(),
    authorId: state.currentUser.id,
    authorName: state.currentUser.displayName,
    authorInitials: state.currentUser.initials,
    authorColor: '#10b981',
    type,
    tickers,
    body,
    likes: 0,
    comments: [],
    timestamp: 'Just now',
    sparklineData: null,
  };
  state.posts.unshift(newPost);
  closeModal();
  renderFeed();
}

// ── MODAL UTILS ───────────────────────────────────────────────────────────────
function showModal(id) {
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}

function closeModal() {
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('create-modal').classList.add('hidden');
  document.getElementById('comment-modal').classList.add('hidden');
  state.activeModal = null;
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
    background: 'var(--gray-900)', color: 'white', padding: '10px 20px',
    borderRadius: '9999px', fontSize: '0.85rem', zIndex: '999',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)', animation: 'fadeSlideIn 0.3s ease',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── MARKET DATA SIMULATION ────────────────────────────────────────────────────
function updateMarketData() {
  state.marketData.forEach(m => {
    const delta = (Math.random() - 0.49) * 0.08;
    m.changeRaw = Math.max(-9.99, Math.min(9.99, m.changeRaw + delta));
    m.positive = m.changeRaw >= 0;
  });
  // Update story pills in-place (no full re-render)
  const pills = document.querySelectorAll('.story-pill');
  pills.forEach((pill, i) => {
    const m = state.marketData[i];
    if (!m) return;
    const ring   = pill.querySelector('.story-ring');
    const change = pill.querySelector('.s-change');
    ring.className  = `story-ring ${m.positive ? '' : 'negative'}`;
    change.className = `s-change ${m.positive ? 'pos' : 'neg'}`;
    change.textContent = `${m.positive ? '+' : ''}${m.changeRaw.toFixed(2)}%`;
  });
}

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────
function attachEventListeners() {
  // Global delegation on feed
  document.getElementById('feed').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, postId, userId } = btn.dataset;
    if (action === 'like')         handleLike(postId);
    else if (action === 'save')    handleSave(postId);
    else if (action === 'follow')  handleFollow(userId);
    else if (action === 'share')   handleShare(postId);
    else if (action === 'open-comments') openCommentsModal(postId);
  });

  // Create post buttons
  document.getElementById('btn-open-create').addEventListener('click', openCreateModal);
  const mobilBtn = document.getElementById('btn-open-create-mobile');
  if (mobilBtn) mobilBtn.addEventListener('click', openCreateModal);

  // Modal close
  document.getElementById('btn-close-create').addEventListener('click', closeModal);
  document.getElementById('btn-close-comment').addEventListener('click', closeModal);
  document.getElementById('overlay').addEventListener('click', closeModal);

  // Submit post
  document.getElementById('btn-submit-post').addEventListener('click', submitPost);
  document.getElementById('post-body-input').addEventListener('input', e => {
    const len = e.target.value.length;
    const el = document.getElementById('char-count');
    el.textContent = `${len} / 280`;
    el.classList.toggle('over', len > 280);
  });
  document.getElementById('post-body-input').addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') submitPost();
  });

  // Submit comment
  document.getElementById('btn-submit-comment').addEventListener('click', submitComment);
  document.getElementById('comment-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitComment();
  });

  // Feed tabs (visual only for now)
  document.querySelectorAll('.feed-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Nav items
  document.querySelectorAll('.nav-item[data-nav], .bnav-item[data-nav]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.nav-item, .bnav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // Keyboard: Escape closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

function attachSuggestedFollowListeners() {
  document.querySelectorAll('[data-action="follow-sug"]').forEach(btn => {
    btn.addEventListener('click', () => handleFollowSug(btn.dataset.userId));
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
function initApp() {
  renderStories();
  renderFeed();
  renderTrendingTickers();
  renderSuggestedUsers();
  attachEventListeners();
  attachSuggestedFollowListeners();

  // Simulate live market updates every 8 seconds
  setInterval(updateMarketData, 8000);

  console.log('%cFinFeed loaded ✓', 'color:#10b981;font-weight:bold;font-size:14px');
}

document.addEventListener('DOMContentLoaded', initApp);
