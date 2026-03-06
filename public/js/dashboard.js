async function loadDashboard() {
  const errEl = document.getElementById('dashboard-error');
  if (errEl) { errEl.style.display = 'none'; errEl.innerHTML = ''; }
  try {
    const [summary, snapshots, taxpayers, kills, metenox, health, scratchpad, expiries] = await Promise.all([
      api.get('/api/summary'),
      api.get('/api/snapshots'),
      api.get('/api/wallet/taxpayers'),
      api.get('/api/kills'),
      api.get('/api/metenox'),
      api.get('/api/health/members').catch(() => ({ summary: null })),
      api.get('/api/settings/scratchpad'),
      api.get('/api/structures/expiries'),
    ]);

    // KPI tiles — wallet breakdown by division
    renderWalletBreakdown(summary.walletDivisions || [], summary.walletBalance);
    document.getElementById('kpi-equity').textContent  = fmtISK(summary.corpEquity)    + ' ISK';
    document.getElementById('kpi-members').textContent = summary.activeMembers;
    document.getElementById('kpi-metenox').textContent = summary.metenoxCount;
    document.getElementById('kpi-members-sub').textContent = `of ${summary.totalMembers} total`;
    const membersBreakdown = document.getElementById('kpi-members-breakdown');
    if (membersBreakdown && health?.summary) {
      const s = health.summary;
      const parts = [];
      if (s.hardcore != null) parts.push(`⚡ Hardcore ${s.hardcore}`);
      if (s.active != null) parts.push(`✓ Active ${s.active}`);
      if (s.atRisk != null) parts.push(`⚠ At risk ${s.atRisk}`);
      if (s.inactive != null) parts.push(`◯ Inactive ${s.inactive}`);
      membersBreakdown.textContent = parts.length ? parts.join(' · ') : '';
      membersBreakdown.style.display = parts.length ? '' : 'none';
    }
    const metenoxKpiCard = document.getElementById('kpi-metenox-card');
    if (metenoxKpiCard) metenoxKpiCard.style.display = summary.metenoxCount > 0 ? '' : 'none';
    document.getElementById('kpi-metenox-sub').textContent = `${summary.structureCount} structures total`;

    // Mining this month (at-a-glance)
    const miningEl = document.getElementById('overview-mining-line');
    if (miningEl) {
      const pilots = summary.miningPilotsThisMonth ?? 0;
      const units = summary.miningUnitsThisMonth ?? 0;
      if (pilots > 0 || units > 0) {
        const u = units >= 1e9 ? (units / 1e9).toFixed(1) + 'B' : units >= 1e6 ? (units / 1e6).toFixed(1) + 'M' : units >= 1e3 ? (units / 1e3).toFixed(1) + 'K' : units;
        miningEl.textContent = `Mining this month: ${pilots} pilot${pilots !== 1 ? 's' : ''} · ${u} units`;
        miningEl.style.display = '';
      } else {
        miningEl.textContent = '';
        miningEl.style.display = 'none';
      }
    }

    // Metenox profit + Corp kills this month (slim cards)
    const glanceEl = document.getElementById('overview-glance');
    const metenoxCard = document.getElementById('overview-metenox-card');
    const metenoxVal  = document.getElementById('overview-metenox-value');
    const killsCard  = document.getElementById('overview-kills-card');
    const killsVal   = document.getElementById('overview-kills-value');
    const killsSub   = document.getElementById('overview-kills-sub');

    let hasGlance = false;
    if (summary.metenoxCount > 0 && metenox?.totals?.totalProfit != null) {
      const profit = metenox.totals.totalProfit;
      metenoxVal.textContent = (profit >= 0 ? '+' : '') + fmtISK(profit) + ' ISK';
      metenoxVal.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
      metenoxCard.style.display = '';
      hasGlance = true;
    } else if (metenoxCard) {
      metenoxCard.style.display = 'none';
    }
    const kCount = summary.killsThisMonth ?? 0;
    const kIsk   = summary.iskDestroyedThisMonth ?? 0;
    if (kCount > 0 || kIsk > 0) {
      if (killsVal) killsVal.textContent = kCount + ' kill' + (kCount !== 1 ? 's' : '');
      if (killsSub) killsSub.textContent = fmtISK(kIsk) + ' ISK destroyed';
      if (killsCard) { killsCard.style.display = ''; hasGlance = true; }
    } else if (killsCard) {
      killsCard.style.display = 'none';
    }
    if (glanceEl) glanceEl.style.display = hasGlance ? 'grid' : 'none';

    // History line chart (use theme colors for color-blind mode)
    if (snapshots.length >= 2) {
      const theme = getThemeColors();
      const labels  = snapshots.map(s => s.month);
      makeLineChart('chart-history', labels, [
        { label: 'Wallet Balance', data: snapshots.map(s => s.wallet_balance),
          borderColor: theme.blue, backgroundColor: themeColorWithAlpha(theme.blue, 0.1), fill: true, tension: 0.3 },
        { label: 'Corp Equity',   data: snapshots.map(s => s.corp_equity || 0),
          borderColor: theme.green, backgroundColor: themeColorWithAlpha(theme.green, 0.08), fill: true, tension: 0.3 },
      ]);
    } else {
      const histCard = document.getElementById('chart-history').closest('.card');
      if (!histCard.querySelector('.snapshot-placeholder')) {
        const p = document.createElement('p');
        p.className = 'empty snapshot-placeholder';
        p.style.marginTop = '10px';
        p.textContent = 'Not enough snapshots yet — use "📸 Snapshot" to record monthly data points.';
        histCard.appendChild(p);
      }
    }

    // Top taxpayers
    renderTopTaxpayers(taxpayers.data, taxpayers.period);

    // Top 5 corp killers
    renderTopKillers(kills.top10?.slice(0, 5) || [], kills.periodLabel || kills.period, kills.totalKills);

    // CEO Scratchpad
    initScratchpad(scratchpad.text || '');

    // Upcoming Expiries
    renderExpiries(expiries);

  } catch (err) {
    console.error('Dashboard load error:', err);
    const errEl = document.getElementById('dashboard-error');
    if (errEl) {
      errEl.innerHTML = `
        <div class="alert alert-error" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <span>Could not load overview: ${esc(err.message)}</span>
          <button type="button" class="btn btn-primary btn-small" id="dashboard-retry-btn">Retry</button>
        </div>`;
      errEl.style.display = 'block';
      document.getElementById('dashboard-retry-btn')?.addEventListener('click', () => loadDashboard());
    } else {
      toast('Dashboard load failed: ' + err.message, 'error');
    }
  }
}

function renderWalletBreakdown(divisions, total) {
  const el = document.getElementById('kpi-wallet-breakdown');
  if (!divisions.length) {
    el.innerHTML = `<div class="value">${fmtISK(total)} ISK</div><div class="sub">ISK total</div>`;
    return;
  }
  const rows = divisions
    .filter(d => d.balance !== 0)
    .map(d => `
      <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <span style="color:var(--text-dim)">Division ${d.division}</span>
        <span style="font-weight:600">${fmtISK(d.balance)}</span>
      </div>`)
    .join('');
  el.innerHTML = rows + `
    <div style="display:flex;justify-content:space-between;padding:5px 0 2px;border-top:1px solid var(--border);margin-top:3px;font-weight:700">
      <span>Total</span>
      <span class="isk">${fmtISK(total)} ISK</span>
    </div>`;
}

function renderTopTaxpayers(data, period) {
  document.getElementById('top-tax-period').textContent = period;
  const el = document.getElementById('top-taxpayers-list');
  if (!data || data.length === 0) {
    el.innerHTML = '<p class="empty">No tax data for this period yet.</p>'; return;
  }
  const max = data[0].total_amount;
  const medals = ['🥇','🥈','🥉','4.','5.'];
  el.innerHTML = data.map((d, i) => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span>${medals[i] || (i+1)+'.'} <strong>${d.main_name || d.character_name}</strong></span>
        <span class="isk">${fmtISK(d.total_amount)} ISK</span>
      </div>
      <div class="bar-outer">
        <div class="bar-fill bar-green" style="width:${(d.total_amount/max*100).toFixed(1)}%"></div>
      </div>
    </div>`).join('');
}

function renderTopKillers(data, period, totalKills) {
  document.getElementById('top-killers-period').textContent =
    period ? `${period} · ${totalKills || 0} kills total` : '';
  const el = document.getElementById('top-killers-list');
  if (!data || data.length === 0) {
    el.innerHTML = '<p class="empty">No kills recorded this month yet.</p>'; return;
  }
  const maxKills = data[0].kills;
  const medals   = ['🥇','🥈','🥉','4.','5.'];
  el.innerHTML = data.map((d, i) => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span>${medals[i] || (i+1)+'.'} <strong>${d.mainName}</strong></span>
        <span style="display:flex;gap:14px;align-items:center">
          <span style="color:var(--red);font-weight:700">⚔ ${d.kills}</span>
          <span class="isk" style="color:var(--text-dim)">${fmtISK(d.totalValue)} ISK</span>
        </span>
      </div>
      <div class="bar-outer">
        <div class="bar-fill" style="width:${(d.kills/maxKills*100).toFixed(1)}%;background:var(--red)"></div>
      </div>
    </div>`).join('');
}

// ── Upcoming Expiries ──────────────────────────────────────────────────────────
function renderExpiries(items) {
  const el = document.getElementById('expiries-content');
  if (!el) return;
  const count = items?.length ?? 0;
  const summary = count === 0
    ? '<p class="empty" style="font-size:0.78rem;color:var(--green);margin-bottom:10px">All structures OK for the next 30 days.</p>'
    : `<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:10px">${count} structure${count !== 1 ? 's' : ''} with fuel or gas expiring within 30 days.</p>`;
  if (!items || items.length === 0) {
    el.innerHTML = summary;
    return;
  }
  el.innerHTML = summary + `
    <table style="width:100%;border-collapse:collapse;font-size:0.76rem">
      <thead>
        <tr>
          <th style="text-align:left;padding:5px 6px;color:var(--text-dim);font-size:0.65rem;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border)">Structure</th>
          <th style="text-align:left;padding:5px 6px;color:var(--text-dim);font-size:0.65rem;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border)">Type</th>
          <th style="text-align:right;padding:5px 6px;color:var(--text-dim);font-size:0.65rem;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border)">Days Left</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => {
          const d     = item.daysLeft;
          const color = d < 7 ? 'var(--red)' : d < 14 ? 'var(--orange)' : 'var(--gold)';
          const icon  = item.type === 'fuel' ? '⛽' : '💨';
          const name  = esc(item.name.length > 22 ? item.name.slice(0, 20) + '…' : item.name);
          return `<tr>
            <td style="padding:5px 6px;border-bottom:1px solid rgba(30,48,79,.4)" title="${esc(item.name)} — ${esc(item.systemName)}">${name}</td>
            <td style="padding:5px 6px;border-bottom:1px solid rgba(30,48,79,.4)">${icon} ${item.type}</td>
            <td style="padding:5px 6px;border-bottom:1px solid rgba(30,48,79,.4);text-align:right;font-weight:700;color:${color}">${d.toFixed(1)}d</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ── CEO Scratchpad ─────────────────────────────────────────────────────────────
let _scratchpadInited = false;

function initScratchpad(savedText) {
  const pad    = document.getElementById('scratchpad');
  const status = document.getElementById('scratchpad-status');
  if (!pad) return;

  // Always refresh text from server (handles edits from another session)
  pad.value = savedText;

  if (_scratchpadInited) return; // only wire events once
  _scratchpadInited = true;

  pad.addEventListener('blur', async () => {
    try {
      await api.put('/api/settings/scratchpad', { text: pad.value });
      if (status) { status.textContent = 'Saved'; setTimeout(() => { status.textContent = ''; }, 2000); }
    } catch {
      if (status) { status.textContent = 'Save failed'; setTimeout(() => { status.textContent = ''; }, 3000); }
    }
  });
}
