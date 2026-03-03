async function loadDashboard() {
  try {
    const [summary, snapshots, taxpayers, kills] = await Promise.all([
      api.get('/api/summary'),
      api.get('/api/snapshots'),
      api.get('/api/wallet/taxpayers'),
      api.get('/api/kills'),
    ]);

    // KPI tiles — wallet breakdown by division
    renderWalletBreakdown(summary.walletDivisions || [], summary.walletBalance);
    document.getElementById('kpi-equity').textContent  = fmtISK(summary.corpEquity)    + ' ISK';
    document.getElementById('kpi-members').textContent = summary.activeMembers;
    document.getElementById('kpi-metenox').textContent = summary.metenoxCount;
    document.getElementById('kpi-members-sub').textContent = `of ${summary.totalMembers} total`;
    document.getElementById('kpi-metenox-sub').textContent = `${summary.structureCount} structures total`;

    // History line chart
    if (snapshots.length >= 2) {
      const labels  = snapshots.map(s => s.month);
      makeLineChart('chart-history', labels, [
        { label: 'Wallet Balance', data: snapshots.map(s => s.wallet_balance),
          borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,.1)', fill: true, tension: 0.3 },
        { label: 'Corp Equity',   data: snapshots.map(s => s.corp_equity || 0),
          borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,.08)', fill: true, tension: 0.3 },
      ]);
    } else {
      document.getElementById('chart-history').closest('.card').innerHTML +=
        '<p class="empty" style="margin-top:10px">Not enough snapshots yet — use "📸 Snapshot" to record monthly data points.</p>';
    }

    // Top taxpayers
    renderTopTaxpayers(taxpayers.data, taxpayers.period);

    // Top 5 corp killers
    renderTopKillers(kills.top10?.slice(0, 5) || [], kills.periodLabel || kills.period, kills.totalKills);

  } catch (err) {
    console.error('Dashboard load error:', err);
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
