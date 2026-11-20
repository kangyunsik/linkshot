import { BOT_DIFFICULTIES, botDifficultyForRating } from '../shared/simulation.js';

const levels = BOT_DIFFICULTIES.map(level => level.id);
const boundedLevel = index => Math.max(0, Math.min(levels.length - 1, index));

export function ratedBotBaseline(rating, gameType) {
  return botDifficultyForRating(Number.isFinite(rating) && gameType === 'ffa' ? rating + 200 : rating);
}

export function assignRatedBotDifficulties(players, gameType, baseline, random = Math.random) {
  const base = boundedLevel(levels.indexOf(baseline));
  const rollLevel = () => {
    const roll = random();
    return levels[boundedLevel(base + (roll < .15 ? -1 : roll < .85 ? 0 : 1))];
  };
  if (gameType !== 'teams') {
    for (const bot of players) if (bot.isBot) bot.botDifficulty = rollLevel();
    return;
  }

  const blue = [], red = [];
  let blueHumans = 0, redHumans = 0;
  for (const player of players) {
    if (player.teamId === 'blue') { if (player.isBot) blue.push(player); else blueHumans++; }
    else if (player.teamId === 'red') { if (player.isBot) red.push(player); else redHumans++; }
  }
  // Match the random defaults for opposing bot slots so neither team gains
  // an accidental advantage from separate rolls when the player counts tie.
  for (let i = 0; i < Math.max(blue.length, red.length); i++) {
    const level = rollLevel();
    if (blue[i]) blue[i].botDifficulty = level;
    if (red[i]) red[i].botDifficulty = level;
  }
  const fewerHumans = blueHumans < redHumans ? blue : redHumans < blueHumans ? red : [];
  const reinforced = levels[boundedLevel(base + 1)];
  // Assign the higher level to up to two slots, counting any that already
  // rolled above the baseline as reinforcements rather than adding more.
  fewerHumans.sort((a, b) => levels.indexOf(b.botDifficulty) - levels.indexOf(a.botDifficulty));
  for (const bot of fewerHumans.slice(0, 2)) bot.botDifficulty = reinforced;
}
