// Chart.js global defaults & factory helpers
Chart.defaults.color        = '#7a95b5';
Chart.defaults.borderColor  = '#1e304f';
Chart.defaults.font.family  = "'Segoe UI', system-ui, sans-serif";

const EVE_COLORS = [
  '#4a9eff','#00d4aa','#f0c040','#9b7fd4','#ff9933',
  '#ff5555','#5ba4f5','#2ecc71','#e74c3c','#e67e22',
];

const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function makeLineChart(id, labels, datasets) {
  destroyChart(id);
  charts[id] = new Chart(document.getElementById(id), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16 } } },
      scales: {
        x: { grid: { color: 'rgba(30,48,79,.5)' }, ticks: { color: '#7a95b5' } },
        y: { grid: { color: 'rgba(30,48,79,.5)' }, ticks: { color: '#7a95b5',
          callback: v => fmtISK(v) } },
      },
    },
  });
}

function makeBarChart(id, labels, datasets, opts = {}) {
  destroyChart(id);
  charts[id] = new Chart(document.getElementById(id), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: opts.horizontal ? 'y' : 'x',
      responsive: true,
      plugins: {
        legend: { display: datasets.length > 1,
          position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${fmtISK(ctx.raw)} ISK` } },
      },
      scales: {
        x: { stacked: opts.stacked, grid: { color: 'rgba(30,48,79,.5)' },
          ticks: { color: '#7a95b5', callback: v => opts.horizontal ? v : fmtISK(v) } },
        y: { stacked: opts.stacked, grid: { display: !opts.horizontal },
          ticks: { color: '#c5d5e8', callback: v => opts.horizontal ? v : fmtISK(v) } },
      },
    },
  });
}

function makeDoughnutChart(id, labels, data, title = '') {
  destroyChart(id);
  const total = data.reduce((a, b) => a + b, 0);
  charts[id] = new Chart(document.getElementById(id), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data, backgroundColor: EVE_COLORS.slice(0, labels.length),
        borderWidth: 2, borderColor: '#0d1526', hoverOffset: 6,
      }],
    },
    options: {
      cutout: '58%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: {
          label: ctx => ` ${ctx.label}: ${fmtISK(ctx.raw)} ISK (${total > 0 ? (ctx.raw / total * 100).toFixed(1) : 0}%)`,
        } },
      },
    },
  });
}
