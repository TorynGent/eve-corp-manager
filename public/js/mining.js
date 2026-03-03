// ── Mining Ledger Tab ─────────────────────────────────────────────────────────
async function loadMining() {
  const periodSel = document.getElementById('mining-period');
  const period    = periodSel?.value || '';

  try {
    const data = await api.get('/api/mining' + (period ? `?period=${period}` : ''));

    // Populate period selector
    if (periodSel && data.periods?.length) {
      const current = periodSel.value;
      periodSel.innerHTML = data.periods.map(p =>
        `<option value="${p}" ${p === (current || data.period) ? 'selected' : ''}>${p}</option>`
      ).join('');
    }

    document.getElementById('mining-period-label').textContent = data.period;
    document.getElementById('mining-miner-count').textContent  = data.totalMiners + ' miners';

    const tbody = document.getElementById('mining-tbody');

    if (!data.miners || data.miners.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No mining data for this period. Run a Sync Now first, then check back — ESI mining ledger covers the last 30 days.</td></tr>';
      destroyChart('chart-mining');
      return;
    }

    const totalValue = data.miners.reduce((s, m) => s + m.totalValue, 0);
    const maxValue   = data.miners[0]?.totalValue || 1;

    tbody.innerHTML = data.miners.map((m, i) => `
      <tr class="miner-row" style="cursor:pointer" onclick="toggleMinerDetail(${i})">
        <td>
          <span style="color:var(--text-dim);margin-right:8px;font-size:0.8rem">${i + 1}.</span>
          <strong>${m.mainName}</strong>
        </td>
        <td class="text-right">${fmtNum(m.totalQty)}</td>
        <td class="text-right isk">${fmtISK(m.totalValue)} ISK</td>
        <td style="min-width:120px">
          <div class="bar-outer"><div class="bar-fill bar-blue" style="width:${(m.totalValue / maxValue * 100).toFixed(1)}%"></div></div>
        </td>
        <td class="text-right dim" style="font-size:0.72rem">${totalValue > 0 ? (m.totalValue / totalValue * 100).toFixed(1) + '%' : '—'}</td>
      </tr>
      <tr id="mining-detail-${i}" style="display:none;background:rgba(0,0,0,.25)">
        <td colspan="5" style="padding:8px 24px 16px">
          <table style="width:100%;font-size:0.78rem">
            <thead><tr>
              <th>Material</th>
              <th class="text-right">Quantity</th>
              <th class="text-right">Jita Buy/unit</th>
              <th class="text-right">Total Value</th>
            </tr></thead>
            <tbody>
              ${m.materials.map(mat => `<tr>
                <td>${mat.typeName}</td>
                <td class="text-right">${fmtNum(mat.quantity)}</td>
                <td class="text-right dim">${mat.unitPrice ? fmtISK(mat.unitPrice) + ' ISK' : '—'}</td>
                <td class="text-right isk">${mat.value ? fmtISK(mat.value) + ' ISK' : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </td>
      </tr>`).join('');

    // Top 10 bar chart
    const top10 = data.miners.slice(0, 10);
    makeBarChart('chart-mining', top10.map(m => m.mainName), [{
      label: 'Mining Value (ISK)',
      data:  top10.map(m => m.totalValue),
      backgroundColor: '#4a9eff99',
      borderColor: '#4a9eff',
      borderWidth: 1,
    }], { horizontal: true });

  } catch (err) {
    document.getElementById('mining-tbody').innerHTML =
      `<tr><td colspan="5" class="alert alert-error">${err.message}</td></tr>`;
  }
}

function toggleMinerDetail(i) {
  const row = document.getElementById(`mining-detail-${i}`);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

document.getElementById('mining-period')?.addEventListener('change', loadMining);
