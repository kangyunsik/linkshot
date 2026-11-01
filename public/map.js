import { WORLD } from '/shared/world.js';
import { TEAM_COLORS, teamSpawnZones } from '/shared/teams.js';

export function drawTacticalMap(canvas, { world = WORLD, players = [], self = null, spawns = false, detailed = false, gameType = 'ffa' } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height, pad = detailed ? 45 : 15;
  const scale = Math.min((w - pad * 2) / world.width, (h - pad * 2) / world.depth);
  const ox = (w - world.width * scale) / 2, oz = (h - world.depth * scale) / 2;
  const x = (v) => ox + (v + world.width / 2) * scale;
  const z = (v) => oz + (v + world.depth / 2) * scale;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = detailed ? '#111c23' : '#0d1920d9'; ctx.fillRect(0, 0, w, h);
  if (gameType === 'teams') for (const team of ['blue', 'red']) {
    const points = teamSpawnZones(world)[team]; ctx.fillStyle = TEAM_COLORS[team] + '28';
    const minX = Math.min(...points.map((p) => p.x)) - 1.5, maxX = Math.max(...points.map((p) => p.x)) + 1.5, minZ = Math.min(...points.map((p) => p.z)) - 1.5, maxZ = Math.max(...points.map((p) => p.z)) + 1.5; ctx.fillRect(x(minX), z(minZ), (maxX - minX) * scale, (maxZ - minZ) * scale);
  }
  ctx.strokeStyle = '#6b9ab311'; ctx.lineWidth = 1;
  for (let i = -world.width / 2; i <= world.width / 2; i += 4) { ctx.beginPath(); ctx.moveTo(x(i), z(-world.depth / 2)); ctx.lineTo(x(i), z(world.depth / 2)); ctx.stroke(); }
  for (let i = -world.depth / 2; i <= world.depth / 2; i += 4) { ctx.beginPath(); ctx.moveTo(x(-world.width / 2), z(i)); ctx.lineTo(x(world.width / 2), z(i)); ctx.stroke(); }
  for (const box of world.obstacles) {
    ctx.fillStyle = box.kind === 'reactor' ? '#577b7a' : box.color === 'orange' ? '#a86b4e' : box.kind === 'wall' ? '#637988' : '#3f5868';
    ctx.strokeStyle = box.color === 'orange' ? '#d29973' : '#8eabb959'; ctx.lineWidth = detailed ? 1.5 : 1;
    ctx.fillRect(x(box.x - box.w / 2), z(box.z - box.d / 2), box.w * scale, box.d * scale);
    if (box.kind !== 'wall') ctx.strokeRect(x(box.x - box.w / 2), z(box.z - box.d / 2), box.w * scale, box.d * scale);
  }
  if (spawns) for (const p of world.spawns) {
    ctx.strokeStyle = '#a3dbc9'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x(p.x), z(p.z), 4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#a3dbc9'; ctx.fillRect(x(p.x) - 1, z(p.z) - 1, 2, 2);
  }
  for (const p of players) {
    if (p.id === self?.id || p.hp <= 0) continue;
    ctx.fillStyle = TEAM_COLORS[p.teamId] || '#ff785e'; ctx.beginPath(); ctx.arc(x(p.x), z(p.z), detailed ? 4 : 3, 0, Math.PI * 2); ctx.fill();
  }
  if (self && self.hp > 0) {
    ctx.save(); ctx.translate(x(self.x), z(self.z)); ctx.rotate(-self.yaw);
    ctx.fillStyle = TEAM_COLORS[self.teamId] || '#b2f6dc'; ctx.strokeStyle = '#132c29'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = '#9ab7c5'; ctx.font = `${detailed ? 12 : 8}px monospace`; ctx.textAlign = 'right';
  ctx.fillText('N ↑', w - (detailed ? 21 : 9), detailed ? 25 : 14);
  if (detailed) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#b5cecacc'; ctx.font = '10px monospace'; ctx.fillText(world.name, x(0), z(0) + 4);
    ctx.textAlign = 'left'; ctx.fillText('TACTICAL VIEW / 01', 22, h - 17);
  }
}
