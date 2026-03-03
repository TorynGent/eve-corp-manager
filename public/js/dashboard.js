async function loadDashboard() {
  try {
    const [summary, snapshots, taxpayers] = await Promise.all([
      api.get('/api/summary'),
      api.get('/api/snapshots'),
      api.get('/api/wallet/taxpayers'),
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

    // Revenue model (static visual)
    document.getElementById('rev-model').innerHTML = revenueModelHTML();

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

function revenueModelHTML() {
  return `
  <div style="display:flex;flex-wrap:wrap;gap:20px;font-size:0.8rem">
    <div style="flex:1;min-width:220px">
      <div style="color:var(--text-dim);margin-bottom:8px;font-size:0.7rem;text-transform:uppercase;letter-spacing:1px">Income Split</div>
      ${revRow('30%', 'Corp Equity', '#4a9eff', 30)}
      ${revRow('70%', 'General Income', '#00d4aa', 70)}
    </div>
    <div style="flex:1;min-width:220px">
      <div style="color:var(--text-dim);margin-bottom:8px;font-size:0.7rem;text-transform:uppercase;letter-spacing:1px">Of General Income</div>
      ${revRow('40%', 'Corp Equity top-up', '#4a9eff', 40)}
      ${revRow('60%', 'Dividends', '#f0c040', 60)}
    </div>
    <div style="flex:1;min-width:220px">
      <div style="color:var(--text-dim);margin-bottom:8px;font-size:0.7rem;text-transform:uppercase;letter-spacing:1px">Dividend Breakdown</div>
      ${revRow('20%', 'Shareholders',   '#9b7fd4', 20)}
      ${revRow('25%', 'Officers',       '#5ba4f5', 25)}
      ${revRow(' 0%', 'Active Members', '#555', 0)}
      ${revRow('50%', 'Fleet Bonus',    '#00d4aa', 50)}
      ${revRow(' 5%', 'Top Tax Payer',  '#f0c040', 5)}
    </div>
  </div>`;
}

function revRow(pct, label, color, width) {
  return `
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <span style="min-width:38px;text-align:right;font-weight:700;color:${color}">${pct}</span>
    <div class="bar-outer" style="flex:1"><div class="bar-fill" style="width:${width}%;background:${color}"></div></div>
    <span style="min-width:160px;color:var(--text)">${label}</span>
  </div>`;
}
