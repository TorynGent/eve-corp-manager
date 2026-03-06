// ── Corp Kills Tab ────────────────────────────────────────────────────────────
async function loadKills() {
  const periodSel = document.getElementById('kills-period');
  const period    = periodSel?.value || 'rolling30';

  try {
    const [data, historyRes] = await Promise.all([
      api.get(`/api/kills?period=${period}`),
      api.get('/api/kills/history'),
    ]);

    // Populate period selector — rolling30 always first, labelled "Last 30 days"
    if (periodSel && data.periods?.length) {
      const current = periodSel.value || 'rolling30';
      periodSel.innerHTML = data.periods.map(p =>
        `<option value="${p}" ${p === current ? 'selected' : ''}>${p === 'rolling30' ? 'Last 30 days' : p}</option>`
      ).join('');
    }

    document.getElementById('kills-total').textContent        = data.totalKills;
    document.getElementById('kills-period-label').textContent = data.periodLabel || data.period;

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

      // Kills count chart (not ISK — use theme colors for color-blind mode)
      const theme = getThemeColors();
      destroyChart('chart-kills');
      charts['chart-kills'] = new Chart(document.getElementById('chart-kills'), {
        type: 'bar',
        data: {
          labels:   data.top10.map(k => k.mainName),
          datasets: [{
            label:           'Kills',
            data:            data.top10.map(k => k.kills),
            backgroundColor: themeColorWithAlpha(theme.red, 0.53),
            borderColor:     theme.red,
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

    // Kill history chart: total kills + ISK destroyed per month
    const history = historyRes?.history || [];
    if (history.length === 0) {
      destroyChart('chart-kills-history');
    } else {
      const theme = getThemeColors();
      const labels = history.map(h => h.period);
      destroyChart('chart-kills-history');
      charts['chart-kills-history'] = new Chart(document.getElementById('chart-kills-history'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Kills',
              data: history.map(h => h.kills),
              backgroundColor: themeColorWithAlpha(theme.red, 0.53),
              borderColor: theme.red,
              borderWidth: 1,
              yAxisID: 'y',
            },
            {
              label: 'ISK destroyed',
              data: history.map(h => h.iskDestroyed),
              type: 'line',
              borderColor: theme.gold,
              backgroundColor: 'transparent',
              borderWidth: 2,
              tension: 0.2,
              fill: false,
              yAxisID: 'y1',
            },
          ],
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  if (ctx.dataset.yAxisID === 'y1') return ` ${ctx.dataset.label}: ${fmtISK(ctx.raw)} ISK`;
                  return ` ${ctx.dataset.label}: ${ctx.raw}`;
                },
              },
            },
          },
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: 'Kills' },
              grid: { color: 'rgba(30,48,79,.5)' },
              ticks: { color: '#7a95b5', stepSize: 1 },
            },
            y1: {
              type: 'linear',
              position: 'right',
              title: { display: true, text: 'ISK destroyed' },
              grid: { drawOnChartArea: false },
              ticks: { color: theme.gold, callback: v => fmtISK(v) },
            },
            x: { grid: { color: 'rgba(30,48,79,.5)' }, ticks: { color: '#7a95b5' } },
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

document.querySelectorAll('.kills-period-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const period = btn.dataset.period;
    const sel = document.getElementById('kills-period');
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
    }
    loadKills();
  });
});

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
    toast('Kills sync error: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '⟳ Sync Kills';
  }
});
