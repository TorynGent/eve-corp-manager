// ── Mining Ledger Tab ─────────────────────────────────────────────────────────
let _miningData = null;

async function loadMining() {
  const periodSel = document.getElementById('mining-period');
  let period = periodSel?.value || '';
  // Default to rolling 30 days when selector not yet populated (aligns with wallet/kills)
  if (!period && periodSel && periodSel.options.length <= 1) period = 'rolling30';

  try {
    const data = await api.get('/api/mining' + (period ? `?period=${encodeURIComponent(period)}` : ''));
    _miningData = data;

    // Populate period selector (first time or when backend adds new options)
    if (periodSel && data.periods?.length) {
      const current = periodSel.value || (data.period === 'Last 30 days' ? 'rolling30' : data.period);
      periodSel.innerHTML = data.periods.map(p =>
        `<option value="${p}" ${p === current ? 'selected' : ''}>${p === 'rolling30' ? 'Last 30 days' : p === 'last3' ? 'Last 3 months' : p}</option>`
      ).join('');
    }

    document.getElementById('mining-period-label').textContent = data.period;
    document.getElementById('mining-miner-count').textContent  = data.totalMiners + ' miners';

    const search = (document.getElementById('mining-search')?.value || '').trim().toLowerCase();
    let miners = data.miners || [];
    if (search) miners = miners.filter(m => (m.mainName || '').toLowerCase().includes(search));

    const tbody = document.getElementById('mining-tbody');

    if (!miners.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No mining data for this period.' + (search ? ' Try a different search.' : ' Run a Sync Now first, then check back — ESI mining ledger covers the last 30 days.') + '</td></tr>';
      destroyChart('chart-mining');
      destroyChart('chart-mining-pie');
      renderMiningByType([]);
      renderMiningExpectedTax(null);
      return;
    }

    const totalValue = miners.reduce((s, m) => s + m.totalValue, 0);
    const maxValue   = miners[0]?.totalValue || 1;

    tbody.innerHTML = miners.map((m, i) => `
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
              ${(m.materials || []).map(mat => `<tr>
                <td>${mat.typeName}</td>
                <td class="text-right">${fmtNum(mat.quantity)}</td>
                <td class="text-right dim">${mat.unitPrice ? fmtISK(mat.unitPrice) + ' ISK' : '—'}</td>
                <td class="text-right isk">${mat.value ? fmtISK(mat.value) + ' ISK' : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </td>
      </tr>`).join('');

    // Pie chart: share by main (aggregated values only; same data as list)
    renderMiningPie(miners);

    // Top 10 bar chart (from unfiltered data for chart)
    const top10 = (data.miners || []).slice(0, 10);
    makeBarChart('chart-mining', top10.map(m => m.mainName), [{
      label: 'Mining Value (ISK)',
      data:  top10.map(m => m.totalValue),
      backgroundColor: '#4a9eff99',
      borderColor: '#4a9eff',
      borderWidth: 1,
    }], { horizontal: true });

    renderMiningByType(data.byType || []);
    loadMiningExpectedTax(period || data.period);
  } catch (err) {
    document.getElementById('mining-tbody').innerHTML =
      `<tr><td colspan="5" class="alert alert-error">${err.message}</td></tr>`;
    destroyChart('chart-mining-pie');
    renderMiningByType([]);
    renderMiningExpectedTax(null);
  }
}

function renderMiningPie(miners) {
  const canvas = document.getElementById('chart-mining-pie');
  if (!canvas || !miners?.length) {
    destroyChart('chart-mining-pie');
    return;
  }
  const topN = 10;
  const slice = miners.slice(0, topN);
  const labels = slice.map(m => m.mainName);
  const data = slice.map(m => m.totalValue);
  if (miners.length > topN) {
    const otherSum = miners.slice(topN).reduce((s, m) => s + m.totalValue, 0);
    labels.push('Other');
    data.push(otherSum);
  }
  destroyChart('chart-mining-pie');
  makeDoughnutChart('chart-mining-pie', labels, data);
}

function renderMiningByType(byType) {
  const wrap = document.getElementById('mining-by-type-wrap');
  const canvas = document.getElementById('chart-mining-by-type');
  if (!wrap) return;
  if (!byType || byType.length === 0) {
    wrap.innerHTML = '<p class="empty">No mining by type for this period.</p>';
    destroyChart('chart-mining-by-type');
    return;
  }
  const totalQty = byType.reduce((s, t) => s + t.quantity, 0);
  const totalVal = byType.reduce((s, t) => s + t.value, 0);
  wrap.innerHTML = `
    <table style="width:100%;font-size:0.78rem;margin-bottom:12px">
      <thead><tr><th>Type</th><th class="text-right">Quantity</th><th class="text-right">Value (ISK)</th><th class="text-right">%</th></tr></thead>
      <tbody>${byType.slice(0, 15).map(t => `
        <tr>
          <td>${t.typeName}</td>
          <td class="text-right">${fmtNum(t.quantity)}</td>
          <td class="text-right isk">${fmtISK(t.value)}</td>
          <td class="text-right dim">${totalQty ? (t.quantity / totalQty * 100).toFixed(1) : 0}%</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  destroyChart('chart-mining-by-type');
  if (byType.length) {
    makeDoughnutChart('chart-mining-by-type',
      byType.slice(0, 12).map(t => t.typeName),
      byType.slice(0, 12).map(t => t.value),
    );
  }
}

async function loadMiningExpectedTax(period) {
  const el = document.getElementById('mining-expected-tax-content');
  if (!el) return;
  try {
    const data = await api.get('/api/mining/expected-tax' + (period ? `?period=${encodeURIComponent(period)}` : ''));
    renderMiningExpectedTax(data);
  } catch {
    renderMiningExpectedTax(null);
  }
}

function renderMiningExpectedTax(data) {
  const el = document.getElementById('mining-expected-tax-content');
  if (!el) return;
  if (!data) {
    el.innerHTML = '<p class="dim">Set mining tax rate in Settings to see expected tax from mining (% of mined volume).</p>';
    return;
  }
  const taxRate = data.taxRatePercent != null ? data.taxRatePercent + '%' : '—';
  const expectedISK = data.expectedTaxFromMining != null ? fmtISK(data.expectedTaxFromMining) + ' ISK' : '—';
  const volumeStr = data.totalMiningVolume != null ? fmtNum(data.totalMiningVolume) + ' units' : '—';
  const expectedVolStr = data.expectedTaxVolume != null ? fmtNum(data.expectedTaxVolume) + ' units' : '—';
  el.innerHTML = `
    <p style="font-size:0.78rem;margin-bottom:8px"><strong>Mining tax rate:</strong> ${taxRate} &nbsp;·&nbsp; <strong>Total mined volume (period):</strong> ${volumeStr}</p>
    <p style="font-size:0.78rem;margin-bottom:8px"><strong>Expected tax from mining</strong> (${data.taxRatePercent != null ? data.taxRatePercent + '% of volume' : 'tax rate'}): ${expectedVolStr} &nbsp;·&nbsp; value at Jita: ${expectedISK}</p>
    <p style="font-size:0.78rem"><strong>Actual tax received</strong> (all sources, from wallet): ${fmtISK(data.actualTaxReceived)} ISK</p>
  `;
}

function toggleMinerDetail(i) {
  const row = document.getElementById(`mining-detail-${i}`);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

document.getElementById('mining-period')?.addEventListener('change', loadMining);

document.getElementById('mining-search')?.addEventListener('input', () => {
  if (_miningData) {
    const search = (document.getElementById('mining-search').value || '').trim().toLowerCase();
    const miners = search ? _miningData.miners.filter(m => (m.mainName || '').toLowerCase().includes(search)) : _miningData.miners;
    const totalValue = miners.reduce((s, m) => s + m.totalValue, 0);
    const maxValue = miners[0]?.totalValue || 1;
    const tbody = document.getElementById('mining-tbody');
    if (!miners.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No miners match that name.</td></tr>';
      destroyChart('chart-mining-pie');
      return;
    }
    tbody.innerHTML = miners.map((m, i) => `
      <tr class="miner-row" style="cursor:pointer" onclick="toggleMinerDetail(${i})">
        <td><span style="color:var(--text-dim);margin-right:8px;font-size:0.8rem">${i + 1}.</span><strong>${m.mainName}</strong></td>
        <td class="text-right">${fmtNum(m.totalQty)}</td>
        <td class="text-right isk">${fmtISK(m.totalValue)} ISK</td>
        <td style="min-width:120px"><div class="bar-outer"><div class="bar-fill bar-blue" style="width:${(m.totalValue / maxValue * 100).toFixed(1)}%"></div></div></td>
        <td class="text-right dim" style="font-size:0.72rem">${totalValue > 0 ? (m.totalValue / totalValue * 100).toFixed(1) + '%' : '—'}</td>
      </tr>
      <tr id="mining-detail-${i}" style="display:none;background:rgba(0,0,0,.25)">
        <td colspan="5" style="padding:8px 24px 16px">
          <table style="width:100%;font-size:0.78rem">
            <thead><tr><th>Material</th><th class="text-right">Quantity</th><th class="text-right">Jita Buy/unit</th><th class="text-right">Total Value</th></tr></thead>
            <tbody>${(m.materials || []).map(mat => `<tr><td>${mat.typeName}</td><td class="text-right">${fmtNum(mat.quantity)}</td><td class="text-right dim">${mat.unitPrice ? fmtISK(mat.unitPrice) + ' ISK' : '—'}</td><td class="text-right isk">${mat.value ? fmtISK(mat.value) + ' ISK' : '—'}</td></tr>`).join('')}</tbody>
          </table>
        </td>
      </tr>`).join('');
    renderMiningPie(miners);
  }
});

document.querySelectorAll('.mining-period-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const period = btn.dataset.period;
    const sel = document.getElementById('mining-period');
    if (!sel) return;
    if (period === 'rolling30') {
      sel.value = 'rolling30';
    } else if (period === 'this') {
      const yyyyMm = new Date().toISOString().slice(0, 7);
      if (![...sel.options].some(o => o.value === yyyyMm)) {
        const opt = document.createElement('option');
        opt.value = yyyyMm;
        opt.textContent = yyyyMm;
        sel.appendChild(opt);
      }
      sel.value = yyyyMm;
    } else if (period === 'last') {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      const yyyyMm = d.toISOString().slice(0, 7);
      if (![...sel.options].some(o => o.value === yyyyMm)) {
        const opt = document.createElement('option');
        opt.value = yyyyMm;
        opt.textContent = yyyyMm;
        sel.appendChild(opt);
      }
      sel.value = yyyyMm;
    } else {
      sel.value = 'last3';
    }
    loadMining();
  });
});

async function downloadMiningCsv() {
  const period = document.getElementById('mining-period')?.value || new Date().toISOString().slice(0, 7);
  const url = `/api/mining/export?period=${encodeURIComponent(period)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(res.statusText);
  const blob = await res.blob();
  const name = res.headers.get('Content-Disposition')?.match(/filename="?([^";\n]+)"?/)?.[1] || `mining-ledger-${period}.csv`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById('mining-export-csv')?.addEventListener('click', async () => {
  try {
    await downloadMiningCsv();
  } catch (err) {
    toast('Export failed: ' + err.message, 'error');
  }
});
