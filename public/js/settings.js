// ── Mappings ──────────────────────────────────────────────────────────────────
async function loadMappings() {
  try {
    const data = await api.get('/api/settings/mappings');
    const tbody = document.getElementById('mappings-tbody');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty">No mappings yet. Add alt → main assignments above.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(m => `
      <tr>
        <td>${m.character_name}</td>
        <td><strong>${m.main_name}</strong></td>
        <td><button class="btn btn-ghost btn-small" onclick="armDelete(this, ${m.character_id})">✕</button></td>
      </tr>`).join('');
  } catch (err) {
    document.getElementById('mappings-tbody').innerHTML =
      `<tr><td colspan="3" class="alert alert-error">${err.message}</td></tr>`;
  }
}

async function deleteMapping(id) {
  await api.del(`/api/settings/mappings/${id}`);
  loadMappings();
}

// Two-stage armed delete — avoids native confirm() which causes Electron focus loss
let _deleteTimer = null;
function armDelete(btn, id) {
  if (btn.dataset.armed) {
    clearTimeout(_deleteTimer);
    _deleteTimer = null;
    deleteMapping(id);
    return;
  }
  btn.dataset.armed = '1';
  btn.textContent = 'Sure?';
  btn.classList.replace('btn-ghost', 'btn-danger');
  _deleteTimer = setTimeout(() => {
    if (btn.isConnected) {
      btn.dataset.armed = '';
      btn.textContent = '✕';
      btn.classList.replace('btn-danger', 'btn-ghost');
    }
    _deleteTimer = null;
  }, 3000);
}

document.getElementById('btn-add-mapping').addEventListener('click', async () => {
  const alt  = document.getElementById('map-alt').value.trim();
  const main = document.getElementById('map-main').value.trim();
  if (!alt || !main) { alert('Both fields are required.'); return; }
  try {
    await api.post('/api/settings/mappings', { characterName: alt, mainName: main });
    document.getElementById('map-alt').value = '';
    document.getElementById('map-main').value = '';
    loadMappings();
  } catch (err) { alert('Error: ' + err.message); }
});

// ── Sync Status ───────────────────────────────────────────────────────────────
async function loadSyncStatus() {
  try {
    const status = await api.get('/api/settings/sync-status');
    const el = document.getElementById('sync-status-list');
    const labels = {
      structures: 'Structures', wallet: 'Wallet Journal',
      assets: 'Corp Assets', mining: 'Mining Ledger',
      observers: 'Moon Observers', market_prices: 'Market Prices',
      members: 'Member Tracking', kills: 'Corp Kills',
    };

    el.innerHTML = Object.entries(status).map(([k, v]) => {
      const age = v.lastSync ? Math.round((Date.now() / 1000 - v.lastSync) / 60) : null;
      const ageStr = age == null ? 'Never' : age < 1 ? 'Just now' : `${age}m ago`;
      const dot    = v.lastError ? 'dot-red' : v.lastSync ? 'dot-green' : 'dot-grey';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <span><span class="dot ${dot}" style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px"></span>${labels[k] || k}</span>
          <span class="dim" style="font-size:0.72rem">${v.lastError ? '⚠️ ' + v.lastError : ageStr}</span>
        </div>`;
    }).join('');
  } catch (err) { console.error('Sync status error:', err); }
}

document.getElementById('btn-full-sync').addEventListener('click', async () => {
  const btn = document.getElementById('btn-full-sync');
  btn.disabled = true; btn.textContent = '⟳ Syncing…';
  try {
    await api.post('/api/settings/sync-now');
    setTimeout(() => { loadSyncStatus(); btn.disabled = false; btn.textContent = '⟳ Full Sync Now'; }, 3000);
  } catch (err) {
    alert('Sync error: ' + err.message);
    btn.disabled = false; btn.textContent = '⟳ Full Sync Now';
  }
});

document.getElementById('btn-manual-snapshot').addEventListener('click', async () => {
  try {
    await api.post('/api/snapshots/create');
    alert('Snapshot created successfully!');
  } catch (err) { alert('Snapshot error: ' + err.message); }
});

// ── Notification Settings ─────────────────────────────────────────────────────
async function loadNotificationSettings() {
  try {
    const cfg = await api.get('/api/settings/notifications');
    document.getElementById('smtp-host').value       = cfg.smtpHost || '';
    document.getElementById('smtp-port').value       = cfg.smtpPort || '587';
    document.getElementById('smtp-user').value       = cfg.smtpUser || '';
    document.getElementById('smtp-from').value       = cfg.smtpFrom || '';
    document.getElementById('smtp-pass').placeholder = cfg.smtpPassSet ? '••••••••  (saved — leave blank to keep)' : 'Password';
    document.getElementById('smtp-recipients').value = cfg.recipients || '';
    document.getElementById('fuel-threshold').value  = cfg.fuelThresholdDays || 14;
    document.getElementById('gas-threshold').value   = cfg.gasThresholdDays  || 7;
    document.getElementById('fuel-threshold-val').textContent = (cfg.fuelThresholdDays || 14) + ' days';
    document.getElementById('gas-threshold-val').textContent  = (cfg.gasThresholdDays  || 7)  + ' days';

    // Load notification log
    const log = await api.get('/api/settings/notifications/log');
    const logEl = document.getElementById('notif-log');
    if (!log.length) {
      logEl.innerHTML = '<p class="dim" style="font-size:0.8rem">No alerts sent yet.</p>'; return;
    }
    logEl.innerHTML = `<table><thead><tr><th>Structure</th><th>Type</th><th>Days Remaining</th><th>Sent</th></tr></thead>
      <tbody>${log.map(l => `<tr>
        <td>${l.structure_name || 'ID:'+l.structure_id}</td>
        <td>${l.alert_type === 'fuel' ? '⛽ Fuel' : '💨 Gas'}</td>
        <td class="${fuelClass(l.days_remaining)}">${l.days_remaining?.toFixed(1)}d</td>
        <td class="dim">${fmtDate(new Date(l.sent_at * 1000).toISOString())}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch (err) { console.error('Notification settings load error:', err); }
}

// Range slider live updates
document.getElementById('fuel-threshold').addEventListener('input', e => {
  document.getElementById('fuel-threshold-val').textContent = e.target.value + ' days';
});
document.getElementById('gas-threshold').addEventListener('input', e => {
  document.getElementById('gas-threshold-val').textContent = e.target.value + ' days';
});

document.getElementById('btn-save-notif').addEventListener('click', async () => {
  const fb = document.getElementById('notif-feedback');
  try {
    const passEl = document.getElementById('smtp-pass');
    const body = {
      smtpHost:         document.getElementById('smtp-host').value,
      smtpPort:         document.getElementById('smtp-port').value,
      smtpUser:         document.getElementById('smtp-user').value,
      smtpFrom:         document.getElementById('smtp-from').value,
      recipients:       document.getElementById('smtp-recipients').value,
      fuelThresholdDays: document.getElementById('fuel-threshold').value,
      gasThresholdDays:  document.getElementById('gas-threshold').value,
    };
    if (passEl.value) body.smtpPass = passEl.value;
    await api.put('/api/settings/notifications', body);
    fb.innerHTML = '<div class="alert alert-ok">Settings saved.</div>';
    passEl.value = '';
    setTimeout(() => { fb.innerHTML = ''; }, 3000);
  } catch (err) {
    fb.innerHTML = `<div class="alert alert-error">Error: ${err.message}</div>`;
  }
});

document.getElementById('btn-test-email').addEventListener('click', async () => {
  const fb = document.getElementById('notif-feedback');
  fb.innerHTML = '<div class="alert alert-info">Sending…</div>';
  try {
    const res = await api.post('/api/settings/notifications/test');
    fb.innerHTML = res.ok
      ? '<div class="alert alert-ok">✅ Test email sent!</div>'
      : `<div class="alert alert-error">Failed: ${res.error}</div>`;
  } catch (err) {
    fb.innerHTML = `<div class="alert alert-error">Error: ${err.message}</div>`;
  }
  setTimeout(() => { fb.innerHTML = ''; }, 5000);
});

// ── CSV Alt→Main Import ───────────────────────────────────────────────────────
document.getElementById('btn-csv-upload')?.addEventListener('click', () => {
  document.getElementById('csv-file-input').click();
});

document.getElementById('csv-file-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fb = document.getElementById('csv-feedback');
  fb.innerHTML = '<span class="dim">Reading file…</span>';
  try {
    const csvText = await file.text();
    const res     = await api.post('/api/settings/mappings/csv', { csvText });
    if (res.ok) {
      fb.innerHTML = `<div class="alert alert-ok">✅ Imported ${res.imported} mappings${res.errors?.length ? ` (${res.errors.length} skipped)` : ''}.</div>`;
      loadMappings();
    } else {
      fb.innerHTML = `<div class="alert alert-error">Error: ${res.error}</div>`;
    }
  } catch (err) {
    fb.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
  e.target.value = '';
  setTimeout(() => { fb.innerHTML = ''; }, 5000);
});

// ── Member Health Weights ─────────────────────────────────────────────────────
function updateHealthWeightSum() {
  const sum = ['hw-tax','hw-mining','hw-kills','hw-activity','hw-fatpap'].reduce((s, id) => {
    const el = document.getElementById(id);
    return s + (el ? parseInt(el.value, 10) || 0 : 0);
  }, 0);
  const lbl = document.getElementById('health-weight-sum-label');
  if (!lbl) return;
  lbl.textContent = `(Total: ${sum}%)`;
  lbl.style.color = sum === 100 ? 'var(--green)' : 'var(--orange)';
}

['hw-tax','hw-mining','hw-kills','hw-activity','hw-fatpap'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', e => {
    document.getElementById(id + '-val').textContent = e.target.value + '%';
    updateHealthWeightSum();
  });
});
document.getElementById('hw-inactive')?.addEventListener('input', e => {
  document.getElementById('hw-inactive-val').textContent = e.target.value + ' days';
});

async function loadHealthWeights() {
  try {
    const cfg = await api.get('/api/health/weights');
    document.getElementById('hw-tax').value               = cfg.weightTax;
    document.getElementById('hw-mining').value            = cfg.weightMining;
    document.getElementById('hw-kills').value             = cfg.weightKills;
    document.getElementById('hw-activity').value          = cfg.weightActivity;
    document.getElementById('hw-fatpap').value            = cfg.weightFatPap;
    document.getElementById('hw-inactive').value          = cfg.inactiveDays;
    document.getElementById('hw-threshold-hardcore').value = cfg.thresholdHardcore;
    document.getElementById('hw-threshold-active').value   = cfg.thresholdActive;
    document.getElementById('hw-threshold-atrisk').value   = cfg.thresholdAtRisk;
    document.getElementById('hw-tax-val').textContent      = cfg.weightTax      + '%';
    document.getElementById('hw-mining-val').textContent   = cfg.weightMining   + '%';
    document.getElementById('hw-kills-val').textContent    = cfg.weightKills    + '%';
    document.getElementById('hw-activity-val').textContent = cfg.weightActivity + '%';
    document.getElementById('hw-fatpap-val').textContent   = cfg.weightFatPap  + '%';
    document.getElementById('hw-inactive-val').textContent = cfg.inactiveDays  + ' days';
    updateHealthWeightSum();
  } catch (err) { console.error('Health weights load error:', err); }
}

document.getElementById('btn-save-health-weights')?.addEventListener('click', async () => {
  const fb  = document.getElementById('health-weights-feedback');
  const sum = ['hw-tax','hw-mining','hw-kills','hw-activity','hw-fatpap'].reduce((s, id) => {
    return s + parseInt(document.getElementById(id).value, 10) || 0;
  }, 0);
  if (sum !== 100) {
    fb.innerHTML = `<div class="alert alert-warn">Weights must sum to 100 (currently ${sum}).</div>`;
    setTimeout(() => { fb.innerHTML = ''; }, 4000);
    return;
  }
  try {
    await api.put('/api/health/weights', {
      weightTax:         document.getElementById('hw-tax').value,
      weightMining:      document.getElementById('hw-mining').value,
      weightKills:       document.getElementById('hw-kills').value,
      weightActivity:    document.getElementById('hw-activity').value,
      weightFatPap:      document.getElementById('hw-fatpap').value,
      inactiveDays:      document.getElementById('hw-inactive').value,
      thresholdHardcore: document.getElementById('hw-threshold-hardcore').value,
      thresholdActive:   document.getElementById('hw-threshold-active').value,
      thresholdAtRisk:   document.getElementById('hw-threshold-atrisk').value,
    });
    fb.innerHTML = '<div class="alert alert-ok">Health weights saved.</div>';
    setTimeout(() => { fb.innerHTML = ''; }, 3000);
  } catch (err) {
    fb.innerHTML = `<div class="alert alert-error">Error: ${esc(err.message)}</div>`;
  }
});

function loadSettings() {
  loadMappings();
  loadSyncStatus();
  loadHealthWeights();
  loadNotificationSettings();
}
