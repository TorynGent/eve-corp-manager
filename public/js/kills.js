// ── Corp Kills Tab ────────────────────────────────────────────────────────────
async function loadKills() {
  const periodSel = document.getElementById('kills-period');
  const period    = periodSel?.value || '';

  try {
    const data = await api.get('/api/kills' + (period ? `?period=${period}` : ''));

    // Populate period selector
    if (periodSel && data.periods?.length) {
      const current = periodSel.value;
      periodSel.innerHTML = data.periods.map(p =>
        `<option value="${p}" ${p === (current || data.period) ? 'selected' : ''}>${p}</option>`
      ).join('');
    }

    document.getElementById('kills-total').textContent       = data.totalKills;
    document.getElementById('kills-period-label').textContent = data.period;

    // Top 10 killers
    const top10El = document.getElementById('kills-top10');
    if (!data.top10 || data.top10.length === 0) {
      top10El.innerHTML = '<p class="empty">No kill data for this period. Click "Sync Kills" to fetch from zKillboard.</p>';
      destroyChart('chart-kills');
    } else {
      const maxKills = data.top10[0]?.kills || 1;
      const medals   = ['🥇', '🥈', '🥉'];
      top10El.innerHTML = data.top10.map((k, i) => `
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span>${medals[i] || (i + 1) + '.'} <strong>${k.mainName}</strong></span>
            <span style="color:var(--isk)">${k.kills} kills &nbsp;·&nbsp; ${fmtISK(k.totalValue)} ISK</span>
          </div>
          <div class="bar-outer">
            <div class="bar-fill bar-red" style="width:${(k.kills / maxKills * 100).toFixed(1)}%"></div>
          </div>
        </div>`).join('');

      // Kills count chart (not ISK — use raw Chart.js)
      destroyChart('chart-kills');
      charts['chart-kills'] = new Chart(document.getElementById('chart-kills'), {
        type: 'bar',
        data: {
          labels:   data.top10.map(k => k.mainName),
          datasets: [{
            label:           'Kills',
            data:            data.top10.map(k => k.kills),
            backgroundColor: '#ff4a4a88',
            borderColor:     '#ff4a4a',
            borderWidth:     1,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${ctx.raw} kills` } },
          },
          scales: {
            x: { grid: { color: 'rgba(30,48,79,.5)' }, ticks: { color: '#7a95b5', stepSize: 1 } },
            y: { grid: { display: false }, ticks: { color: '#c5d5e8' } },
          },
        },
      });
    }

    // Recent kills table
    const tbody = document.getElementById('kills-tbody');
    if (!data.recentKills || data.recentKills.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No recent kills found.</td></tr>';
    } else {
      tbody.innerHTML = data.recentKills.map(k => `
        <tr>
          <td class="dim">${fmtDate(k.killTime)}</td>
          <td>${k.victimShip || '—'}</td>
          <td>${k.systemName || '—'}</td>
          <td class="text-right isk">${fmtISK(k.totalValue)} ISK</td>
          <td>
            <a href="https://zkillboard.com/kill/${k.killId}/" target="_blank"
               class="btn btn-ghost btn-small" rel="noopener">zKill ↗</a>
          </td>
        </tr>`).join('');
    }

  } catch (err) {
    document.getElementById('kills-top10').innerHTML =
      `<div class="alert alert-error">${err.message}</div>`;
  }
}

document.getElementById('kills-period')?.addEventListener('change', loadKills);

document.getElementById('btn-sync-kills')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync-kills');
  btn.disabled = true;
  btn.textContent = '⟳ Syncing…';
  try {
    await api.post('/api/kills/sync');
    setTimeout(() => {
      loadKills();
      btn.disabled = false;
      btn.textContent = '⟳ Sync Kills';
    }, 5000);
  } catch (err) {
    alert('Kills sync error: ' + err.message);
    btn.disabled = false;
    btn.textContent = '⟳ Sync Kills';
  }
});
