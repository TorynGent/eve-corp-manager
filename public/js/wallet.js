let journalPage = 1;
let journalPages = 1;

async function loadWallet() {
  await Promise.all([
    loadTaxCharts(),
    loadJournal(),
    loadWalletHistory(),
  ]);
}

async function loadTaxCharts() {
  try {
    const period = document.getElementById('wallet-period-select').value || undefined;
    const [groups, top5] = await Promise.all([
      api.get('/api/wallet/groups', period ? { period } : {}),
      api.get('/api/wallet/taxpayers', { limit: 5, ...(period ? { period } : {}) }),
    ]);

    // Donut chart — by main group
    if (groups.data && groups.data.length) {
      makeDoughnutChart('chart-tax-donut',
        groups.data.map(g => g.main_name || 'Unknown'),
        groups.data.map(g => g.total),
      );
    }

    // Top 5 list
    const el = document.getElementById('top5-tax');
    if (!top5.data || top5.data.length === 0) {
      el.innerHTML = '<p class="empty">No tax data available for this period.</p>'; return;
    }
    const max = top5.data[0].total_amount;
    const medals = ['🥇', '🥈', '🥉', '4th', '5th'];
    el.innerHTML = `
      <table><thead><tr><th>#</th><th>Character</th><th>Main Group</th><th class="text-right">Total ISK</th><th style="min-width:150px">Share</th></tr></thead>
      <tbody>${top5.data.map((d, i) => `
        <tr>
          <td class="dim">${medals[i] || (i+1)}</td>
          <td><strong>${d.character_name}</strong></td>
          <td class="dim">${d.main_name !== d.character_name ? d.main_name : '—'}</td>
          <td class="text-right isk">${fmtISK(d.total_amount)} ISK</td>
          <td><div class="bar-outer"><div class="bar-fill bar-green" style="width:${(d.total_amount/max*100).toFixed(1)}%"></div></div></td>
        </tr>`).join('')}
      </tbody></table>`;

  } catch (err) {
    console.error('Tax chart error:', err);
  }
}

async function loadWalletHistory() {
  try {
    const rows = await api.get('/api/wallet/history', { days: 30 });
    if (!rows.length) return;
    makeLineChart('chart-wallet-balance',
      rows.map(r => r.day),
      [{
        label: 'TAX income',
        data: rows.map(r => r.balance),
        borderColor: '#4a9eff',
        backgroundColor: 'rgba(74,158,255,.1)',
        fill: true, tension: 0.3,
      }]
    );
  } catch (err) {
    console.error('Wallet history error:', err);
  }
}

async function loadJournal() {
  const filter = document.getElementById('journal-filter').value.trim();
  try {
    const period = document.getElementById('wallet-period-select').value || undefined;
    const data = await api.get('/api/wallet/journal', {
      page: journalPage,
      ...(filter ? { type: filter } : {}),
      ...(period ? { period } : {}),
    });

    journalPages = data.pages;
    document.getElementById('journal-page-info').textContent =
      `Page ${data.page} of ${data.pages} (${data.total.toLocaleString()} entries)`;
    document.getElementById('journal-prev').disabled = journalPage <= 1;
    document.getElementById('journal-next').disabled = journalPage >= journalPages;

    const tbody = document.getElementById('journal-tbody');
    if (!data.rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No journal entries found.</td></tr>'; return;
    }

    tbody.innerHTML = data.rows.map(r => {
      const amtClass = r.amount >= 0 ? 'green' : 'red';
      const amtSign  = r.amount >= 0 ? '+' : '';
      return `<tr>
        <td class="dim">${fmtDate(r.date)}</td>
        <td class="dim">${r.division}</td>
        <td style="font-size:0.72rem;color:var(--text-dim)">${r.ref_type}</td>
        <td style="font-size:0.75rem">${r.second_party_id ? `<span class="dim">${r.second_party_id}</span>` : '—'}</td>
        <td class="text-right ${amtClass}">${amtSign}${fmtISK(r.amount)} ISK</td>
        <td class="text-right isk">${fmtISK(r.balance)} ISK</td>
      </tr>`;
    }).join('');
  } catch (err) {
    document.getElementById('journal-tbody').innerHTML =
      `<tr><td colspan="6" class="alert alert-error">Error: ${err.message}</td></tr>`;
  }
}

// Load available periods for the selector
// The "Last 30 days" default option (value="") is already in the HTML.
// We append historical months below it so the user can browse past months.
async function loadWalletPeriods() {
  try {
    const periods = await api.get('/api/wallet/periods');
    const sel = document.getElementById('wallet-period-select');
    periods.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });
  } catch { /* ignore */ }
}

document.getElementById('journal-prev').addEventListener('click', () => {
  if (journalPage > 1) { journalPage--; loadJournal(); }
});
document.getElementById('journal-next').addEventListener('click', () => {
  if (journalPage < journalPages) { journalPage++; loadJournal(); }
});
document.getElementById('journal-filter').addEventListener('keydown', e => {
  if (e.key === 'Enter') { journalPage = 1; loadJournal(); }
});
document.getElementById('wallet-period-select').addEventListener('change', () => {
  journalPage = 1; loadTaxCharts(); loadJournal();
});
