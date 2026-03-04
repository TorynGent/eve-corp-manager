// ── Gas & Fuel Stock ──────────────────────────────────────────────────────────
async function loadStructureInventory() {
  const gasEl  = document.getElementById('gas-stock-content');
  const fuelEl = document.getElementById('fuel-stock-content');
  try {
    const inv = await api.get('/api/structures/inventory');
    const { gas, fuel } = inv;

    // ── Magmatic Gas ──
    if (!gas.total) {
      gasEl.innerHTML = '<p class="dim" style="padding:10px;font-size:0.82rem">No Magmatic Gas found in corp hangars. Run an asset sync first.</p>';
    } else {
      const daysColor = gas.daysLeft == null ? '' : gas.daysLeft < 7 ? 'color:var(--red)' : gas.daysLeft < 14 ? 'color:var(--gold)' : 'color:var(--green)';
      const totalLine = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px;border-bottom:1px solid var(--border);margin-bottom:8px">
          <span style="font-size:0.85rem;font-weight:700">Total: ${fmtNum(gas.total)} units</span>
          <span style="font-size:0.85rem;font-weight:700;${daysColor}">${gas.daysLeft != null ? gas.daysLeft + 'd remaining' : '—'}
            <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400"> (${gas.metenoxCount} Metenox × 200/hr)</span>
          </span>
        </div>`;
      const rows = gas.rows.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.8rem;border-bottom:1px solid rgba(255,255,255,.05)">
          <span style="color:var(--text-dim)">${r.system_name ? r.system_name + ' — ' : ''}${r.structure_name}
            <button type="button" onclick="editLocName(${r.location_id},'${r.structure_name.replace(/'/g,"\\'")}')"
              style="margin-left:6px;background:none;border:none;cursor:pointer;font-size:0.72rem;opacity:.5;padding:0" title="Set custom name">✏️</button>
          </span>
          <span style="font-weight:600">${fmtNum(r.qty)}</span>
        </div>`).join('');
      gasEl.innerHTML = totalLine + rows;
    }

    // ── Fuel Blocks ──
    if (!fuel.total) {
      fuelEl.innerHTML = '<p class="dim" style="padding:10px;font-size:0.82rem">No Fuel Blocks found in corp hangars. Run an asset sync first.</p>';
    } else {
      const daysColor = fuel.daysLeft == null ? '' : fuel.daysLeft < 14 ? 'color:var(--red)' : fuel.daysLeft < 30 ? 'color:var(--gold)' : 'color:var(--green)';
      const totalLine = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px;border-bottom:1px solid var(--border);margin-bottom:8px">
          <span style="font-size:0.85rem;font-weight:700">Total: ${fmtNum(fuel.total)} blocks</span>
          <span style="font-size:0.85rem;font-weight:700;${daysColor}">${fuel.daysLeft != null ? fuel.daysLeft + 'd remaining' : '—'}
            <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400"> (${fuel.structureCount} structs × 5/hr)</span>
          </span>
        </div>`;
      const rows = fuel.rows.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.8rem;border-bottom:1px solid rgba(255,255,255,.05)">
          <span style="color:var(--text-dim)">${r.system_name ? r.system_name + ' — ' : ''}${r.structure_name}
            <button type="button" onclick="editLocName(${r.location_id},'${r.structure_name.replace(/'/g,"\\'")}')"
              style="margin-left:6px;background:none;border:none;cursor:pointer;font-size:0.72rem;opacity:.5;padding:0" title="Set custom name">✏️</button>
          </span>
          <span><span style="font-size:0.72rem;color:var(--text-dim);margin-right:6px">${r.type_name}</span>
            <strong>${fmtNum(r.qty)}</strong>
          </span>
        </div>`).join('');
      fuelEl.innerHTML = totalLine + rows;
    }

  } catch (err) {
    const msg = `<p class="alert alert-error" style="padding:8px;font-size:0.8rem">${err.message}</p>`;
    gasEl.innerHTML = fuelEl.innerHTML = msg;
  }
}

async function loadStructures() {
  loadStructureInventory(); // load gas/fuel stock in parallel
  try {
    const data = await api.get('/api/structures');
    const tbody = document.getElementById('structures-tbody');
    const tfoot = document.getElementById('structures-tfoot');
    const alertsEl = document.getElementById('struct-alerts');

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No structures found. Trigger a sync to load structure data.</td></tr>';
      return;
    }

    // Collect alerts
    const fuelThreshold = 14, gasThreshold = 7;
    const alerts = data.filter(s =>
      (s.fuelDaysLeft != null && s.fuelDaysLeft <= fuelThreshold) ||
      (s.gas?.daysLeft != null && s.gas.daysLeft <= gasThreshold)
    );
    if (alerts.length) {
      alertsEl.innerHTML = alerts.map(s => {
        const parts = [];
        if (s.fuelDaysLeft != null && s.fuelDaysLeft <= fuelThreshold)
          parts.push(`⛽ Fuel: ${s.fuelDaysLeft}d`);
        if (s.gas?.daysLeft != null && s.gas.daysLeft <= gasThreshold)
          parts.push(`💨 Gas: ${s.gas.daysLeft}d`);
        return `<div class="alert alert-warn">⚠️ <strong>${s.name}</strong> (${s.systemName}) — ${parts.join('  ·  ')}</div>`;
      }).join('');
    } else {
      alertsEl.innerHTML = '';
    }

    // Render rows
    tbody.innerHTML = data.map(s => {
      const typeColor = s.typeId === 81826 ? 'var(--green)' : s.typeId === 35835 ? 'var(--gold)' : 'var(--blue)';
      const fuelBar = s.fuelDaysLeft != null
        ? `<div class="bar-outer"><div class="bar-fill ${fuelBarClass(s.fuelDaysLeft)}" style="width:${barPct(s.fuelDaysLeft)}%"></div></div>`
        : '—';
      const fuelDaysCell = s.fuelDaysLeft != null
        ? `<span class="${fuelClass(s.fuelDaysLeft)}">${s.fuelDaysLeft}d</span>` : '—';

      let gasBar = '—', gasDaysCell = '—', gasAction = '';
      if (s.isMetenox) {
        const g = s.gas;
        gasBar = g?.daysLeft != null
          ? `<div class="bar-outer"><div class="bar-fill ${fuelBarClass(g.daysLeft)}" style="width:${barPct(g.daysLeft, 60)}%"></div></div>`
          : '<span class="dim">Not set</span>';
        gasDaysCell = g?.daysLeft != null
          ? `<span class="${fuelClass(g.daysLeft)}">${g.daysLeft}d</span>`
          : '<span class="dim">?</span>';
        gasAction = `<button class="btn btn-ghost btn-small" onclick="openGasModal(${s.structureId},'${s.name.replace(/'/g, "\\'")}',${JSON.stringify(s.gas || {}).replace(/"/g, '&quot;')})">💨 Gas</button>`;
      }

      return `<tr>
        <td><strong>${s.name}</strong></td>
        <td><span style="color:${typeColor}">${s.typeName}</span></td>
        <td>${s.systemName}</td>
        <td class="text-right dim">${fmtDate(s.fuelExpires)}</td>
        <td class="text-right">${fuelDaysCell}</td>
        <td>${fuelBar}</td>
        <td class="text-right">${gasDaysCell}</td>
        <td>${gasBar}</td>
        <td>${gasAction}</td>
      </tr>`;
    }).join('');

    // Footer totals
    const fuelPerMonth  = data.reduce((s, r) => s + (r.typeName === 'Fortizar' ? 5400 : r.typeName === 'Athanor' ? 9360 : r.isMetenox ? 3600 : 0), 0);
    const gasPerMonth   = data.filter(r => r.isMetenox).length * 144000;
    tfoot.innerHTML = `<tr>
      <td colspan="3"><strong>Totals</strong></td>
      <td></td><td></td>
      <td class="isk"><strong>${fuelPerMonth.toLocaleString()} fuel/mo</strong></td>
      <td></td>
      <td class="isk"><strong>${gasPerMonth.toLocaleString()} gas/mo</strong></td>
      <td></td>
    </tr>`;

  } catch (err) {
    document.getElementById('structures-tbody').innerHTML =
      `<tr><td colspan="9" class="alert alert-error">Error: ${err.message}</td></tr>`;
  }
}

function openGasModal(structureId, name, gasData) {
  document.getElementById('gas-modal-id').value = structureId;
  document.getElementById('gas-modal-name').textContent = name;
  document.getElementById('gas-refill-date').value   = gasData.lastRefillDate   || '';
  document.getElementById('gas-qty').value            = gasData.quantityRefilled  || '';
  document.getElementById('gas-daily').value          = gasData.dailyConsumption  || 4800;
  document.getElementById('gas-notes').value          = gasData.notes             || '';
  const modal = document.getElementById('gas-modal');
  modal.style.display = 'flex';
}

function closeGasModal() {
  document.getElementById('gas-modal').style.display = 'none';
}

async function saveGasModal() {
  const id = document.getElementById('gas-modal-id').value;
  try {
    await api.put(`/api/structures/${id}/gas`, {
      lastRefillDate:  document.getElementById('gas-refill-date').value,
      quantityRefilled: parseInt(document.getElementById('gas-qty').value, 10),
      dailyConsumption: parseInt(document.getElementById('gas-daily').value, 10),
      notes:           document.getElementById('gas-notes').value,
    });
    closeGasModal();
    loadStructures();
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
}

document.getElementById('gas-modal-cancel').addEventListener('click', closeGasModal);
document.getElementById('gas-modal-save').addEventListener('click', saveGasModal);

// ── Manual location name override ─────────────────────────────────────────────
let _locRenameId = null;

function editLocName(locationId, currentName) {
  _locRenameId = locationId;
  const input = document.getElementById('loc-rename-input');
  input.value = currentName || '';
  document.getElementById('loc-rename-modal').style.display = 'flex';
  setTimeout(() => input.focus(), 50);
}

document.getElementById('loc-rename-cancel').addEventListener('click', () => {
  document.getElementById('loc-rename-modal').style.display = 'none';
  _locRenameId = null;
});

document.getElementById('loc-rename-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    document.getElementById('loc-rename-modal').style.display = 'none';
    _locRenameId = null;
  }
});

document.getElementById('loc-rename-save').addEventListener('click', async () => {
  if (_locRenameId == null) return;
  const newName = document.getElementById('loc-rename-input').value;
  document.getElementById('loc-rename-modal').style.display = 'none';
  try {
    await api.put('/api/structures/location-name', { locationId: _locRenameId, name: newName });
    loadStructureInventory();
  } catch (err) {
    alert('Failed to save name: ' + err.message);
  }
  _locRenameId = null;
});

document.getElementById('loc-rename-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('loc-rename-save').click();
  if (e.key === 'Escape') document.getElementById('loc-rename-cancel').click();
});
