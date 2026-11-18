import { normalizeRankBadge, rankBadgeLabel, rankEmblem } from '/shared/ranks.js';

export function rankBadgeNode(value, showLabel = false) {
  const badge = normalizeRankBadge(value); if (!badge) return null;
  const node = document.createElement('span'); node.className = 'player-rank-mark'; node.dataset.ladder = badge.ladder; node.dataset.tier = badge.tier;
  node.title = rankBadgeLabel(badge); node.setAttribute('aria-label', node.title);
  const image = document.createElement('img'); image.src = rankEmblem(badge.tier, badge.ladder); image.alt = ''; image.width = image.height = 24; node.append(image);
  if (showLabel) { const label = document.createElement('span'); label.textContent = node.title; node.append(label); }
  return node;
}
export function updateRankBadge(root, value, showLabel = true) {
  if (!root) return;
  const badge = normalizeRankBadge(value), signature = JSON.stringify([badge, showLabel]);
  if (root.dataset.badge === signature) return;
  root.dataset.badge = signature; root.hidden = !badge; root.replaceChildren();
  if (badge) root.append(rankBadgeNode(badge, showLabel));
}
