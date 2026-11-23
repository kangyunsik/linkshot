import { RANGE_PLOT } from '/shared/range-world.js';

export function updateRangeView(range) {
  const panel = document.getElementById('range-hud');
  panel.hidden = !range;
  if (!range) return;
  const { shots, hits, outside, distance, points } = range;
  document.getElementById('range-distance-label').textContent = `기준선 ${distance}m`;
  document.getElementById('range-shots').textContent = shots;
  document.getElementById('range-hits').textContent = hits;
  document.getElementById('range-accuracy').textContent = shots ? `${Math.round(100 * hits / shots)}%` : '—';
  document.getElementById('range-outside').textContent = outside ? `표시 범위 밖·표적에 닿지 않은 탄 ${outside}개` : '';
  const canvas = document.getElementById('range-plot'), ctx = canvas.getContext('2d');
  const scale = Math.min((canvas.width - 24) / (RANGE_PLOT.halfWidth * 2), (canvas.height - 20) / RANGE_PLOT.height);
  const x = value => canvas.width / 2 + value * scale, y = value => canvas.height - 10 - value * scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#557373'; ctx.lineWidth = 1;
  ctx.strokeRect(x(-RANGE_PLOT.halfWidth), y(RANGE_PLOT.height), RANGE_PLOT.halfWidth * 2 * scale, RANGE_PLOT.height * scale);
  ctx.setLineDash([3, 4]); ctx.beginPath();
  ctx.moveTo(x(0), y(0)); ctx.lineTo(x(0), y(RANGE_PLOT.height)); ctx.moveTo(x(-RANGE_PLOT.halfWidth), y(1.05)); ctx.lineTo(x(RANGE_PLOT.halfWidth), y(1.05));
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#38595f'; ctx.fillRect(x(-.27), y(1.37), .54 * scale, .69 * scale);
  ctx.beginPath(); ctx.arc(x(0), y(1.58), .21 * scale, 0, Math.PI * 2); ctx.fill();
  for (const point of points) {
    ctx.fillStyle = point.hit ? '#b1edd5' : '#e9aa82';
    ctx.beginPath(); ctx.arc(x(point.x), y(point.y), 2.9, 0, Math.PI * 2); ctx.fill();
  }
}
