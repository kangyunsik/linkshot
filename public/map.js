import { WORLD } from '/shared/world.js';
import { TEAM_COLORS, teamSpawnZones } from '/shared/teams.js';
import { isTeamGame } from '/shared/game-types.js';

export function drawTacticalMap(canvas, { world = WORLD, players = [], self = null, spawns = false, detailed = false, gameType = 'ffa', objective = null } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height, pad = detailed ? 45 : 15;
  const scale = Math.min((w - pad * 2) / world.width, (h - pad * 2) / world.depth);
  const ox = (w - world.width * scale) / 2, oz = (h - world.depth * scale) / 2;
  const below = Boolean(world.underground && self?.y < -.28);
  const x = (v) => ox + (v + world.width / 2) * scale;
  const z = (v) => oz + (v + world.depth / 2) * scale;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = detailed ? '#111c23' : '#0d1920d9'; ctx.fillRect(0, 0, w, h);
  if (world.arenaProfile) {
    ctx.fillStyle = detailed ? '#223942' : '#223842';
    ctx.fillRect(ox, oz, world.width * scale, world.depth * scale);
  }
  if (!below && isTeamGame(gameType)) for (const team of ['blue', 'red']) {
    const points = teamSpawnZones(world)[team]; ctx.fillStyle = TEAM_COLORS[team] + '28';
    const minX = Math.min(...points.map((p) => p.x)) - 1.5, maxX = Math.max(...points.map((p) => p.x)) + 1.5, minZ = Math.min(...points.map((p) => p.z)) - 1.5, maxZ = Math.max(...points.map((p) => p.z)) + 1.5; ctx.fillRect(x(minX), z(minZ), (maxX - minX) * scale, (maxZ - minZ) * scale);
  }
  ctx.strokeStyle = '#6b9ab311'; ctx.lineWidth = 1;
  for (let i = -world.width / 2; i <= world.width / 2; i += 4) { ctx.beginPath(); ctx.moveTo(x(i), z(-world.depth / 2)); ctx.lineTo(x(i), z(world.depth / 2)); ctx.stroke(); }
  for (let i = -world.depth / 2; i <= world.depth / 2; i += 4) { ctx.beginPath(); ctx.moveTo(x(-world.width / 2), z(i)); ctx.lineTo(x(world.width / 2), z(i)); ctx.stroke(); }
  const structures = new Set();
  for (const building of below ? [] : world.buildings || []) {
    structures.add(building.id);
    ctx.fillStyle = '#365462';
    ctx.fillRect(x(building.x - building.w / 2), z(building.z - building.d / 2), building.w * scale, building.d * scale);
  }
  for (const link of world.roofBridges || []) structures.add(link.id);
  for (const box of world.obstacles) {
    if (below || box.kind === 'ground-slab' || box.kind?.startsWith('basement-')) continue;
    if (structures.has(box.buildingId) && (box.y > .01 || box.kind !== 'building-wall')) continue;
    const setback = box.kind === 'arena-setback';
    ctx.fillStyle = setback ? '#15242c' : box.kind === 'reactor' ? '#577b7a' : box.color === 'orange' ? '#a86b4e' : box.kind === 'wall' ? '#637988' : '#3f5868';
    ctx.strokeStyle = box.color === 'orange' ? '#d29973' : '#8eabb959'; ctx.lineWidth = detailed ? 1.5 : 1;
    if (box.shape === 'cylinder' || box.shape === 'ring') {
      ctx.beginPath(); ctx.arc(x(box.x), z(box.z), box.w / 2 * scale, 0, Math.PI * 2);
      if (box.shape === 'ring') ctx.arc(x(box.x), z(box.z), box.innerRadius * scale, 0, Math.PI * 2, true);
      ctx.fill('evenodd'); ctx.stroke();
      if (box.cutHalf) { ctx.fillStyle = detailed ? '#111c23' : '#0d1920'; ctx.fillRect(x(box.x - box.w / 2), z(box.z - box.cutHalf), box.w * scale, box.cutHalf * 2 * scale); ctx.fillRect(x(box.x - box.cutHalf), z(box.z - box.d / 2), box.cutHalf * 2 * scale, box.d * scale); }
    } else {
      ctx.fillRect(x(box.x - box.w / 2), z(box.z - box.d / 2), box.w * scale, box.d * scale);
      if (setback && box.arenaFace) {
        const vertical = ['west', 'east'].includes(box.arenaFace), sign = ['west', 'north'].includes(box.arenaFace) ? 1 : -1;
        ctx.strokeStyle = '#94abb18c'; ctx.beginPath();
        if (vertical) {
          const edge = x(box.x + sign * box.w / 2); ctx.moveTo(edge, z(box.z - box.d / 2)); ctx.lineTo(edge, z(box.z + box.d / 2));
        } else {
          const edge = z(box.z + sign * box.d / 2); ctx.moveTo(x(box.x - box.w / 2), edge); ctx.lineTo(x(box.x + box.w / 2), edge);
        }
        ctx.stroke();
      } else if (box.kind !== 'wall') ctx.strokeRect(x(box.x - box.w / 2), z(box.z - box.d / 2), box.w * scale, box.d * scale);
    }
  }
  if (detailed && world.crossing) drawAlleyAnnotations(ctx, world.crossing, x, z);
  if (!below) drawBuildingRoutes(ctx, world, x, z, scale, detailed);
  if (world.underground) drawBasementRoutes(ctx, world.underground, x, z, scale, detailed, below);
  for (const point of world.hardpoints || []) { const active = objective?.point?.id === point.id; ctx.strokeStyle = active ? TEAM_COLORS[objective.owner] || '#f2cd89' : '#c3b99088'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = active ? 2 : 1; ctx.beginPath(); ctx.arc(x(point.x), z(point.z), point.radius * scale, 0, Math.PI * 2); ctx.stroke(); ctx.font = `${detailed ? 13 : 9}px monospace`; ctx.textAlign = 'center'; ctx.fillText(point.id, x(point.x), z(point.z) + 3); }
  if (world.defenseCore) { const core = world.defenseCore; ctx.fillStyle = '#8ee0c4'; ctx.fillRect(x(core.x) - 4, z(core.z) - 4, 8, 8); }
  if (spawns) for (const p of world.spawns) {
    ctx.strokeStyle = '#a3dbc9'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x(p.x), z(p.z), 4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#a3dbc9'; ctx.fillRect(x(p.x) - 1, z(p.z) - 1, 2, 2);
  }
  for (const p of players) {
    if (p.id === self?.id || p.hp <= 0 || world.underground && (p.y < -.28) !== below) continue;
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
    ctx.textAlign = 'left'; ctx.fillStyle = '#b5cecacc'; ctx.font = '10px monospace'; ctx.fillText(world.name, 22, 25);
    ctx.textAlign = 'left'; ctx.fillText('TACTICAL VIEW / 01', 22, h - 17);
  }
}

function drawBasementRoutes(ctx, underground, x, z, scale, detailed, below) {
  ctx.save();
  if (below) {
    ctx.fillStyle = '#3f6266';
    for (const r of [...underground.passages, ...underground.rooms]) ctx.fillRect(x(r.x - r.w / 2), z(r.z - r.d / 2), r.w * scale, r.d * scale);
  }
  const points = [underground.entrances[0].top, ...underground.path, underground.entrances.at(-1).top];
  ctx.strokeStyle = below ? '#9ce6d8' : '#8fc7bb'; ctx.lineWidth = detailed ? 2 : 1.25;
  const line = (route) => {
    ctx.beginPath(); ctx.moveTo(x(route[0].x), z(route[0].z));
    for (const p of route.slice(1)) ctx.lineTo(x(p.x), z(p.z));
    ctx.stroke();
  };
  ctx.setLineDash(below ? [] : [4, 3]); line(points);
  ctx.strokeStyle = '#efb676';
  for (const branch of underground.branches) line(branch.path);
  ctx.setLineDash([]); ctx.strokeStyle = below ? '#9ce6d8' : '#8fc7bb';
  for (const { top } of underground.entrances) {
    ctx.fillStyle = '#183e45'; ctx.beginPath(); ctx.arc(x(top.x), z(top.z), detailed ? 7 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (detailed) { ctx.fillStyle = '#c9efe5'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.fillText('B1', x(top.x), z(top.z) + 3); }
  }
  if (detailed || below) {
    ctx.fillStyle = '#a6d7cb'; ctx.font = detailed ? '11px system-ui' : '9px monospace'; ctx.textAlign = detailed ? 'right' : 'left';
    const legend = [underground.label, ...underground.branches.map(branch => branch.label)].join(' · ');
    ctx.fillText(detailed ? `B1 / ${legend}` : 'B1 / 지하', detailed ? ctx.canvas.width - 22 : 9, ctx.canvas.height - (detailed ? 17 : 9));
  }
  ctx.restore();
}

function drawBuildingRoutes(ctx, world, x, z, scale, detailed) {
  ctx.save();
  for (const link of world.roofBridges || []) {
    const left = x(link.x - link.w / 2), top = z(link.z - link.d / 2);
    ctx.fillStyle = '#5b929bd9'; ctx.fillRect(left, top, link.w * scale, link.d * scale);
    ctx.strokeStyle = '#c7f0ebcc'; ctx.lineWidth = detailed ? 1.4 : .75; ctx.setLineDash(detailed ? [4, 3] : [2, 2]);
    ctx.strokeRect(left, top, link.w * scale, link.d * scale);
  }
  ctx.setLineDash([]);
  if (detailed) for (const building of world.buildings || []) {
    for (const door of building.doors) {
      ctx.strokeStyle = '#ebbd8d'; ctx.lineWidth = 2.25; ctx.beginPath();
      const alongX = door.axis === 'x', half = door.width * .45;
      ctx.moveTo(x(door.x - (alongX ? half : 0)), z(door.z - (alongX ? 0 : half)));
      ctx.lineTo(x(door.x + (alongX ? half : 0)), z(door.z + (alongX ? 0 : half))); ctx.stroke();
    }
    for (const stair of building.stairs) {
      const [a, b] = stair.flights[0], length = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
      ctx.strokeStyle = '#8bb7c2'; ctx.lineWidth = 1.8; ctx.beginPath();
      for (const t of [.29, .51, .73]) {
        const px = a.x + t * (b.x - a.x), pz = a.z + t * (b.z - a.z), width = stair.width * .41;
        ctx.moveTo(x(px - dz * width), z(pz + dx * width)); ctx.lineTo(x(px + dz * width), z(pz - dx * width));
      }
      ctx.stroke();
    }
  }
  if (detailed && world.buildings?.length) {
    ctx.textAlign = 'right'; ctx.font = '11px system-ui'; ctx.fillStyle = '#bacccd';
    ctx.fillText(world.roofBridges?.length ? '출입구 · 계단 · 옥상 연결교' : '출입구 · 계단', ctx.canvas.width - 60, 25);
  }
  ctx.restore();
}

function drawAlleyAnnotations(ctx, crossing, x, z) {
  ctx.save();
  const vertical = crossing.axis === 'z', at = (across, along) => vertical ? [x(across), z(along)] : [x(along), z(across)];
  for (const [i, lane] of crossing.lanes.entries()) {
    const origin = at(lane.center, lane.start), end = at(lane.center, lane.end), badge = at(lane.center, crossing.at);
    ctx.strokeStyle = '#e8b989'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(...origin); ctx.lineTo(...end); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#18272e'; ctx.beginPath(); ctx.arc(...badge, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center'; ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#ffdfa9'; ctx.fillText(String(i + 1), badge[0], badge[1] + 3.5);
  }
  ctx.textAlign = 'right'; ctx.font = '11px system-ui'; ctx.fillStyle = '#e9c7a0';
  ctx.fillText(crossing.lanes.map((lane, i) => `${i + 1} ${lane.name}`).join('   /   '), ctx.canvas.width - 22, ctx.canvas.height - 17);
  ctx.restore();
}
