import { mkdir, writeFile } from 'node:fs/promises';
import { TEAM_WORLDS } from '../shared/team-worlds.js';

const destination = new URL('../public/assets/maps/', import.meta.url); await mkdir(destination, { recursive: true });
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
for (const world of TEAM_WORLDS) {
  const scale = Math.min(900 / world.width, 580 / world.depth), x = (v) => 500 + v * scale, z = (v) => 390 + v * scale, shapes = [];
  for (const box of world.obstacles) {
    const fill = box.slope ? '#c8a86e' : box.walkable ? '#74968f' : box.kind === 'core' ? '#8ee0c4' : box.kind === 'wall' ? '#405862' : '#8d8b79';
    if (box.shape === 'ring') { shapes.push(`<path d="M${x(box.x) + box.w * scale / 2},${z(box.z)}a${box.w * scale / 2},${box.w * scale / 2} 0 1 0 -${box.w * scale},0a${box.w * scale / 2},${box.w * scale / 2} 0 1 0 ${box.w * scale},0 M${x(box.x) + box.innerRadius * scale},${z(box.z)}a${box.innerRadius * scale},${box.innerRadius * scale} 0 1 0 -${box.innerRadius * scale * 2},0a${box.innerRadius * scale},${box.innerRadius * scale} 0 1 0 ${box.innerRadius * scale * 2},0" fill="${fill}" fill-rule="evenodd"/>`); if (box.cutHalf) shapes.push(`<rect x="${x(-box.cutHalf)}" y="${z(-box.w / 2)}" width="${box.cutHalf * 2 * scale}" height="${box.w * scale}" fill="${world.ground}"/><rect x="${x(-box.w / 2)}" y="${z(-box.cutHalf)}" width="${box.w * scale}" height="${box.cutHalf * 2 * scale}" fill="${world.ground}"/>`); continue; }
    if (box.shape === 'cylinder') shapes.push(`<circle cx="${x(box.x)}" cy="${z(box.z)}" r="${box.w * scale / 2}" fill="${fill}" stroke="#d8e1cc" stroke-width="1"/>`);
    else shapes.push(`<rect x="${x(box.x - box.w / 2)}" y="${z(box.z - box.d / 2)}" width="${box.w * scale}" height="${box.d * scale}" fill="${fill}" stroke="#d8e1cc" stroke-width="1"/>`);
  }
  for (const point of world.spawns) shapes.push(`<circle cx="${x(point.x)}" cy="${z(point.z)}" r="6" fill="${point.teamId === 'blue' ? '#79baff' : '#ff817a'}" stroke="#14242b" stroke-width="2"/>`);
  for (const point of world.hardpoints || []) shapes.push(`<circle cx="${x(point.x)}" cy="${z(point.z)}" r="${point.radius * scale}" fill="#ecc97933" stroke="#ffe0a1" stroke-width="3"/><text x="${x(point.x)}" y="${z(point.z) + 8}" text-anchor="middle" font-size="24" fill="#fff0cc">${point.id}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="760" viewBox="0 0 1000 760"><title>${escape(world.name)} / ${escape(world.label)}</title><rect width="1000" height="760" fill="#14252d"/><text x="42" y="54" fill="#d8ece4" font-family="sans-serif" font-weight="bold" font-size="36">${world.name}</text><text x="44" y="88" fill="#a9c4be" font-family="sans-serif" font-size="20">${escape(world.label)} / ${escape(world.tag)}</text><rect x="${x(-world.width / 2)}" y="${z(-world.depth / 2)}" width="${world.width * scale}" height="${world.depth * scale}" fill="${world.ground}"/>${shapes.join('')}<text x="42" y="730" fill="#b6d1c9" font-family="sans-serif" font-size="18">${world.width} × ${world.depth} M / BLUE = 수비·블루 / RED = 공세·레드 / HAND-AUTHORED TERRAIN</text></svg>`;
  await writeFile(new URL(`${world.id}.svg`, destination), svg); console.log(`Created map preview: ${world.previewImage}`);
}
