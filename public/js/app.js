// ── Bootstrap ─────────────────────────────────────────────────────────────────
(async function init() {
  try {
    const me = await api.get('/auth/me');
    if (!me.loggedIn) {
      document.getElementById('login-page').style.display = 'flex';
      return;
    }

    // Show app
    document.getElementById('login-page').style.display = 'none';
    const appEl = document.getElementById('app');
    appEl.classList.add('visible');

    // Header
    const initials = (me.corporationName || 'CORP').substring(0, 2).toUpperCase();
    document.getElementById('hdr-logo').textContent  = initials;
    document.getElementById('hdr-corp').textContent  = me.corporationName || 'Your Corporation';
    document.getElementById('hdr-char').textContent  = `Logged in as ${me.characterName}`;
    document.title = `${me.corporationName || 'EVE'} Dashboard`;

    // Load initial tab
    loadTabContent('overview');

    // Start auto-refresh every 60 seconds
    setInterval(() => {
      const active = document.querySelector('.tab-panel.active')?.id?.replace('tab-', '');
      if (active) refreshTab(active);
    }, 60_000);

    // Update sync indicator every 30s
    updateSyncDot();
    setInterval(updateSyncDot, 30_000);

    // Load wallet periods once
    loadWalletPeriods();

  } catch (err) {
    console.error('Init error:', err);
    document.getElementById('login-page').style.display = 'flex';
  }
})();

// ── Tab Navigation ────────────────────────────────────────────────────────────
let loadedTabs = new Set();

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    document.getElementById('tab-' + name).classList.add('active');
    loadTabContent(name);
  });
});

function loadTabContent(name) {
  loadedTabs.add(name);
  switch (name) {
    case 'overview':   loadDashboard();   break;
    case 'structures': loadStructures();  break;
    case 'metenox':    loadMetenox();     break;
    case 'wallet':     loadWallet();      break;
    case 'mining':     loadMining();      break;
    case 'kills':      loadKills();       break;
    case 'settings':   loadSettings();    break;
  }
}

function refreshTab(name) {
  if (!loadedTabs.has(name)) return;
  switch (name) {
    case 'overview':   loadDashboard();   break;
    case 'structures': loadStructures();  break;
    case 'metenox':    loadMetenox();     break;
    case 'wallet':     loadTaxCharts(); loadWalletHistory(); break;
    case 'mining':     loadMining();      break;
    case 'kills':      loadKills();       break;
    case 'settings':   loadSyncStatus();  break;
  }
}

// ── Header Actions ────────────────────────────────────────────────────────────
document.getElementById('btn-sync-now').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync-now');
  btn.disabled = true; btn.textContent = '⟳ Syncing…';
  setSyncDot('grey', 'Syncing…');
  try {
    await api.post('/api/settings/sync-now');
    // Wait a moment then refresh current tab
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active')?.id?.replace('tab-', '');
      if (active) loadTabContent(active);
      btn.disabled = false; btn.textContent = '⟳ Sync Now';
      setSyncDot('green', 'Synced');
    }, 4000);
  } catch (err) {
    btn.disabled = false; btn.textContent = '⟳ Sync Now';
    setSyncDot('red', 'Sync failed');
    alert('Sync error: ' + err.message);
  }
});

document.getElementById('btn-snapshot').addEventListener('click', async () => {
  try {
    await api.post('/api/snapshots/create');
    alert('📸 Monthly snapshot created!');
  } catch (err) { alert('Snapshot error: ' + err.message); }
});

// ── Sync Indicator ────────────────────────────────────────────────────────────
async function updateSyncDot() {
  try {
    const status = await api.get('/api/settings/sync-status');
    const hasError = Object.values(status).some(v => v.lastError);
    const hasSynced = Object.values(status).some(v => v.lastSync);
    if (hasError) setSyncDot('red', 'Sync error');
    else if (hasSynced) {
      const ages = Object.values(status).map(v => v.lastSync || 0);
      const newest = Math.max(...ages);
      const minAgo = Math.round((Date.now() / 1000 - newest) / 60);
      setSyncDot('green', `Updated ${minAgo < 1 ? 'just now' : minAgo + 'm ago'}`);
    } else setSyncDot('grey', 'Not synced');
  } catch { setSyncDot('grey', 'Offline'); }
}

function setSyncDot(color, label) {
  const dot = document.getElementById('sync-dot');
  dot.className = `dot dot-${color}`;
  document.getElementById('sync-label').textContent = label;
}
