// ── Member Health Tab ─────────────────────────────────────────────────────────

let _healthData = null;
let _healthSort = { col: 'healthScore', dir: -1 }; // -1 = desc

async function loadHealth() {
  try {
    const data = await api.get('/api/health/members');
    _healthData = data;
    renderHealthKpis(data.summary);
    renderHealthTable(data);

    // Show active weights in card-title
    const lbl = document.getElementById('health-weights-label');
    if (lbl) {
      const w = data.weights;
      lbl.textContent = `Tax ${w.tax}% · Mining ${w.mining}% · Kills ${w.kills}% · Activity ${w.activity}%`;
    }
  } catch (err) {
    document.getElementById('health-tbody').innerHTML =
      `<tr><td colspan="9" class="alert alert-error">Error: ${esc(err.message)}</td></tr>`;
  }
}

function renderHealthKpis(s) {
  document.getElementById('hkpi-active').textContent   = s.active;
  document.getElementById('hkpi-atrisk').textContent   = s.atRisk;
  document.getElementById('hkpi-inactive').textContent = s.inactive;
  document.getElementById('hkpi-total').textContent    = s.total;
}

function renderHealthTable(data) {
  const tbody   = document.getElementById('health-tbody');
  let members   = [...data.members];

  // Sort
  const { col, dir } = _healthSort;
  members.sort((a, b) => {
    const av = typeof a[col] === 'string' ? a[col].toLowerCase() : (a[col] ?? 0);
    const bv = typeof b[col] === 'string' ? b[col].toLowerCase() : (b[col] ?? 0);
    return av < bv ? -dir : av > bv ? dir : 0;
  });

  if (members.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No member data yet — run a full sync.</td></tr>';
    return;
  }

  tbody.innerHTML = members.map((m, i) => {
    const statusBadge = m.status === 'active'   ? '<span class="badge badge-green">Active</span>'
                      : m.status === 'atrisk'   ? '<span class="badge badge-gold">At Risk</span>'
                      :                           '<span class="badge badge-red">Inactive</span>';
    const barColor = m.healthScore >= 70 ? 'var(--green)' : m.healthScore >= 30 ? 'var(--orange)' : 'var(--red)';
    const loginAge = m.daysSinceLogin != null
      ? (m.daysSinceLogin < 1 ? 'Today' : m.daysSinceLogin < 2 ? 'Yesterday' : `${Math.round(m.daysSinceLogin)}d ago`)
      : '—';
    const loginColor = m.daysSinceLogin > data.inactiveDays ? 'var(--red)'
                     : m.daysSinceLogin > data.inactiveDays * 0.5 ? 'var(--orange)'
                     : 'var(--text)';

    return `<tr>
      <td class="dim" style="font-size:0.72rem">${i + 1}</td>
      <td><strong>${esc(m.mainName)}</strong>${m.altCount > 0 ? `<span class="dim" style="font-size:0.7rem;margin-left:5px">(+${m.altCount} alt${m.altCount > 1 ? 's' : ''})</span>` : ''}</td>
      <td style="min-width:130px">
        <div style="display:flex;align-items:center;gap:6px">
          <div class="bar-outer" style="flex:1;min-width:60px">
            <div class="bar-fill" style="width:${m.healthScore.toFixed(1)}%;background:${barColor}"></div>
          </div>
          <span style="font-weight:700;color:${barColor};min-width:34px;text-align:right;font-size:0.82rem">${m.healthScore.toFixed(0)}</span>
        </div>
      </td>
      <td style="min-width:80px">${miniBar(m.taxScore, 'var(--green)')}</td>
      <td style="min-width:80px">${miniBar(m.miningScore, 'var(--blue)')}</td>
      <td style="min-width:80px">${miniBar(m.killScore, 'var(--red)')}</td>
      <td style="min-width:80px">${miniBar(m.activityScore, 'var(--purple)')}</td>
      <td style="color:${loginColor};font-size:0.78rem">${loginAge}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');
}

function miniBar(score, color) {
  return `<div style="display:flex;align-items:center;gap:4px">
    <div class="bar-outer" style="flex:1;height:5px;min-width:50px">
      <div style="height:100%;border-radius:4px;background:${color};width:${score.toFixed(1)}%;transition:width 0.3s"></div>
    </div>
    <span style="font-size:0.7rem;color:var(--text-dim);min-width:26px;text-align:right">${score.toFixed(0)}</span>
  </div>`;
}

// Sortable column headers
document.addEventListener('DOMContentLoaded', () => {
  const table = document.getElementById('health-table');
  if (!table) return;
  table.querySelectorAll('th.sortable').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (_healthSort.col === col) {
        _healthSort.dir *= -1;
      } else {
        _healthSort.col = col;
        _healthSort.dir = col === 'mainName' ? 1 : -1;
      }
      if (_healthData) renderHealthTable(_healthData);
    });
  });
});
