// All shop content as plain data. Effects are implemented in game.js (acquire / produce / etc.).
// Edit names, prices and rarities here to rebalance without touching the engine.

export const RARITY_WEIGHTS = { common: 70, rare: 25, legendary: 5 };

// Loading table: [favoured face, opposite face, each side face, cost of this level]
export const LOADING = [
  [0.259, 0.115, 0.157, 2],
  [0.337, 0.09, 0.143, 3],
  [0.404, 0.075, 0.13, 5],
  [0.46, 0.06, 0.12, 8],
  [0.508, 0.05, 0.111, 12],
  [0.549, 0.04, 0.103, 18],
  [0.584, 0.033, 0.096, 27],
  [0.614, 0.027, 0.09, 40],
  [0.639, 0.023, 0.085, 60],
  [0.66, 0.02, 0.08, 90],
];

const I = (cat, id, name, rarity, price, desc, extra = {}) => ({ cat, id, name, rarity, price, desc, ...extra });

export const ITEM_LIST = [
  // ---- Face upgrades (value-setters replace each other; triggers stack)
  I('face', 'reforge', 'Reforge', 'common', 2, 'Change a face to a random different value.', { kind: 'setter' }),
  I('face', 'raise', 'Raise', 'common', 3, 'Increase a face by 1 (6 wraps to 1).', { kind: 'setter' }),
  I('face', 'lower', 'Lower', 'common', 3, 'Decrease a face by 1 (1 wraps to 6).', { kind: 'setter' }),
  I('face', 'lucky', 'Lucky Number', 'common', 3, 'When this face shows, every producing hex gives +1.', { kind: 'trigger' }),
  I('face', 'knightFav', "Knight's Favorite", 'common', 3, 'When this face shows and the robber blocks a hex with the rolled number, the robber moves to a random different hex.', { kind: 'trigger' }),
  I('face', 'knightLucky', "Knight's Lucky Number", 'rare', 7, 'As Knight\'s Favorite, and you collect the blocked hex\'s production.', { kind: 'trigger' }),
  I('face', 'robberFav', "Robber's Favorite", 'common', 3, 'When this face is part of a 7, you place the robber.', { kind: 'trigger' }),
  I('face', 'robberLucky', "Robber's Lucky Number", 'rare', 7, 'When part of a 7, place the robber and collect that hex\'s production.', { kind: 'trigger' }),
  I('face', 'hidden', 'Hidden', 'common', 4, 'When this face is part of a 7, you don\'t discard.', { kind: 'trigger' }),
  I('face', 'mirror', 'Mirror Face', 'rare', 8, 'This face takes the other die\'s value.', { kind: 'setter' }),
  I('face', 'robberFace', "Robber's Face", 'rare', 6, 'The roll counts as a 7; gain 2 resources of your choice.', { kind: 'setter' }),
  I('face', 'blank', 'Blank Face', 'rare', 10, 'Choose this face\'s value after rolling.', { kind: 'setter' }),

  // ---- Die upgrades
  I('die', 'loaded', 'Loaded', 'common', 2, 'One face becomes more likely. Buy again to level up (1–10).'),
  I('die', 'nudge', 'Nudge', 'common', 3, 'Once per round, change this die by ±1.'),
  I('die', 'recast', 'Recast', 'common', 4, 'Once per round, reroll this die.'),
  I('die', 'twin', 'Twin Die', 'rare', 8, 'Roll this die twice, keep one result.'),
  I('die', 'alchemist', 'Alchemist', 'legendary', 18, 'Once per round, set this die to any value.'),
  I('die', 'echo', 'Echo', 'legendary', 20, 'On a double, roll this die again as a free extra roll.'),
  I('die', 'copycat', 'Copycat', 'legendary', 16, 'Gains all die effects of the other die, except loading.'),

  // ---- Token upgrades
  I('token', 'tokenSwap', 'Token Swap', 'common', 2, 'Swap two adjacent number tokens.', { kind: 'setter' }),
  I('token', 'shift', 'Shift', 'common', 3, 'Move a token ±1 (2–12, 7 allowed).', { kind: 'setter' }),
  I('token', 'doubleToken', 'Double Token', 'rare', 8, 'The hex gets a second (random) number token.'),
  I('token', 'jackpot', 'Jackpot Token', 'rare', 8, 'On 2/12: ×3 production; on 3/11: ×2.'),
  I('token', 'twinToken', 'Twin Token', 'rare', 7, 'Produces double on doubles.'),
  I('token', 'sevenToken', 'Seven Token', 'rare', 9, 'Also produces on a 7, before the robber acts.'),
  I('token', 'heartland', 'Heartland', 'legendary', 18, 'Also produces on its number ±1.'),
  I('token', 'evergreen', 'Evergreen', 'legendary', 15, 'Produces 1 on every roll where nothing else produces.'),

  // ---- Hex upgrades
  I('hex', 'terraform', 'Terraform', 'common', 2, 'Change a hex to a random different terrain.', { kind: 'setter' }),
  I('hex', 'clearDesert', 'Clear the Desert', 'common', 4, 'The desert gets a random terrain and the token 7.', { kind: 'setter' }),
  I('hex', 'fertile', 'Fertile Soil', 'common', 3, '+1 production.'),
  I('hex', 'palisade', 'Palisade', 'common', 3, 'The robber can\'t block this hex.'),
  I('hex', 'surveyor', 'Surveyor', 'rare', 7, 'Change a hex\'s terrain to one of your choice.', { kind: 'setter' }),
  I('hex', 'gold', 'Gold Field', 'rare', 9, 'Produces a resource of your choice.'),
  I('hex', 'river', 'River', 'rare', 8, 'Each of your roads along this hex gives +1 VP income per round.'),
  I('hex', 'guildDistrict', 'Guild District', 'rare', 9, 'Cities on this hex produce 3 instead of 2.'),
  I('hex', 'volcanic', 'Volcanic Soil', 'rare', 7, '×2 production, but an eruption check after each payout.'),
  I('hex', 'sister', 'Sister Valleys', 'legendary', 18, 'Link to another hex: whenever one produces, so does the other.'),
  I('hex', 'haven', "Robber's Haven", 'legendary', 16, 'While the robber sits here, it produces double instead of nothing.'),
  I('hex', 'capital', 'Capital', 'legendary', 20, 'A city on this hex counts 4 VP.'),

  // ---- Port upgrades
  I('port', 'overflow', 'Overflow', 'common', 4, 'Leftover cards that don\'t complete a batch can be shipped 1:1 (7 ore at 6+1 → 8).'),
  I('port', 'bigger', 'Bigger Return', 'rare', 8, '+1 bonus per batch (stacks).'),
  I('port', 'smaller', 'Smaller Batch', 'rare', 8, '−1 batch input, minimum 1 (stacks).'),
  I('port', 'freePort', 'Free Port', 'legendary', 16, 'Shipments may mix resource types (generic ports only).'),

  // ---- Classic development cards (single use, hand slot)
  I('classic', 'knight', 'Knight', 'common', 2, 'Move the robber to any hex; counts toward largest army.'),
  I('classic', 'roadBuilding', 'Road Building', 'common', 3, 'Build 2 free roads.'),
  I('classic', 'yearOfPlenty', 'Year of Plenty', 'common', 3, 'Take any 2 resources.'),
  I('classic', 'monopoly', 'Monopoly', 'common', 4, 'Name a resource: for the rest of the round, all your production becomes it.'),
  I('classic', 'vpCard', 'Victory Point', 'common', 5, '+1 permanent VP (applies immediately).'),

  // ---- Edicts (single use, hand slot)
  I('edict', 'bumper', 'Bumper Harvest', 'common', 3, 'Your next roll produces double.'),
  I('edict', 'bribe', 'Bribe', 'common', 3, 'Reduce the current tribute by 2.'),
  I('edict', 'census', 'Census', 'common', 3, 'Gain 1 resource of your choice per settlement.'),
  I('edict', 'fireSale', 'Fire Sale', 'common', 3, 'Trade 2:1 with the bank for the rest of the round.'),
  I('edict', 'omen', 'Omen', 'rare', 6, 'Name a number; if the next roll hits it, production is tripled.'),
  I('edict', 'levyDelay', 'Levy Delay', 'rare', 6, 'Push this round\'s tribute to the next round, at +50%.'),
  I('edict', 'demolition', 'Demolition', 'rare', 5, 'Remove one of your buildings and gain double its cost.'),

  // ---- Guilds (persistent, Guild slot)
  I('guild', 'mathematicians', 'Mathematicians', 'common', 5, 'Hexes on 6 or 8 produce +1.'),
  I('guild', 'granary', 'Granary', 'common', 4, 'Grain doesn\'t count toward the hand limit and is never discarded.'),
  I('guild', 'longShot', 'Long Shot', 'common', 5, 'A roll of 2 or 12 gives 4 resources of your choice.'),
  I('guild', 'twinFortune', 'Twin Fortune', 'common', 5, 'Every double gives +1 VP.'),
  I('guild', 'moneylender', 'Moneylender', 'rare', 8, 'Each generic port you own gives every specific port +1 bonus.'),
  I('guild', 'tradeConsul', 'Trade Consul', 'rare', 8, 'Each specific port you own lowers every generic port\'s input by 1.'),
  I('guild', 'taxCollector', 'Tax Collector', 'rare', 9, 'Each city reduces every tribute by 1.'),
  I('guild', 'robbersFriend', "Robber's Friend", 'rare', 7, 'The robber ignores cards equal to 7s rolled minus knights played.'),
  I('guild', 'firePriests', 'Fire Priests', 'rare', 8, 'Volcanic hexes also give 1 resource of choice; reroll one eruption per round.'),
  I('guild', 'squatters', "Squatter's Rights", 'rare', 10, 'Ignore the distance rule.'),
  I('guild', 'monoculture', 'Monoculture', 'rare', 7, 'One terrain produces +2, all others −1.'),
  I('guild', 'cartographer', 'Cartographer', 'rare', 8, 'Beyond longest road, every extra segment gives +1 VP.'),
  I('guild', 'marshal', 'Marshal', 'rare', 8, 'Beyond largest army, every extra knight gives +1 VP.'),

  // ---- Charters (immediate, +50% price per copy bought)
  I('charter', 'townCharter', 'Town Charter', 'rare', 8, '+1 settlement limit.'),
  I('charter', 'royalCharter', 'Royal Charter', 'rare', 10, '+1 city limit.'),
  I('charter', 'highwayCharter', 'Highway Charter', 'rare', 6, '+5 road limit.'),
  I('charter', 'guildExpansion', 'Guild Expansion', 'rare', 12, '+1 Guild slot.'),
  I('charter', 'deepPockets', 'Deep Pockets', 'rare', 6, '+1 hand slot.'),
  I('charter', 'forgery', 'Forgery', 'legendary', 20, 'A second copy of a unique upgrade you own.'),
  I('charter', 'lostFound', 'Lost and Found', 'legendary', 15, 'Return a taken unique upgrade to the pool; it appears in the next shop.'),
];

export const ITEMS = Object.fromEntries(ITEM_LIST.map((i) => [i.id, i]));

export const CATEGORY_GROUPS = {
  dice: ['face', 'die'],
  field: ['token', 'hex', 'port'],
  dev: ['classic', 'edict', 'guild', 'charter'],
};

export function isUnique(item) {
  if (['face', 'die'].includes(item.cat)) return item.rarity !== 'common';
  if (['token', 'hex', 'port'].includes(item.cat)) return item.rarity === 'legendary';
  return false;
}

export const BOSSES = [
  { id: 'fog', gentle: true, name: 'The Fog', source: 'Seafarers', desc: 'Tokens on your 3 best hexes are hidden and shuffled among them this round.' },
  { id: 'doldrums', gentle: true, name: 'The Doldrums', source: 'Seafarers', desc: 'Rolls of 2, 3, 11 and 12 produce nothing.' },
  { id: 'pirate', name: 'The Pirate', source: 'Seafarers', desc: 'No shipments this round; one tribute type is fixed to wool.' },
  { id: 'barbarians', name: 'The Barbarian Fleet', source: 'Cities & Knights', desc: 'Each 7 or double advances the fleet; at 3 a random building is hit. Knights push it back.' },
  { id: 'caravan', name: 'The Caravan', source: 'Traders & Barbarians', desc: 'Tribute types are set randomly; one changes after every roll.' },
  { id: 'volcano', name: 'The Volcano', source: 'Seafarers', desc: 'A volcano sits on your best hex: eruption check after each payout (no ×2).' },
  { id: 'flood', gentle: true, name: 'The Flood', source: 'Traders & Barbarians', desc: 'Odd numbers produce nothing.' },
  { id: 'robberBaron', gentle: true, name: 'The Robber Baron', source: 'Base game', desc: 'On a 7, the robber also takes half the Storehouse.' },
  { id: 'oldBoot', name: 'The Old Boot', source: 'Fishermen', desc: 'Each roll that produces nothing raises the tribute by 1.' },
];
export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
// Ante 1 only draws from the gentle bosses; the run-wreckers start in ante 2.
export const GENTLE_UNTIL_ANTE = 1;

// Tribute per ante: [Small parts, Big parts, Boss parts]. Each number is one part, paid in its own resource type.
// "Breather" curve: each ante's Small is a breather below the previous boss, then Big and Boss climb.
// Ante 1's boss asks for two types; three types from ante 2. Totals roughly double every two antes.
// Beyond the table, every part of the last ante is multiplied by 1.5 (rounded up) per extra ante.
export const TRIBUTE_TABLE = [
  [[1], [1, 1], [2, 1]],             // ante 1: kick-start (boss: two types)
  [[1], [2, 1], [2, 1, 1]],          // ante 2: three types from here
  [[2], [3, 2], [3, 2, 1]],          // ante 3
  [[3], [4, 3], [5, 3, 2]],          // ante 4
  [[4], [6, 4], [7, 4, 3]],          // ante 5
  [[6], [9, 6], [10, 6, 4]],         // ante 6
  [[9], [13, 9], [15, 9, 6]],        // ante 7
];
export function tributeFor(ante, blind) {
  const i = ante - 1;
  if (i < TRIBUTE_TABLE.length) return [...TRIBUTE_TABLE[i][blind]];
  let parts = [...TRIBUTE_TABLE[TRIBUTE_TABLE.length - 1][blind]];
  for (let k = TRIBUTE_TABLE.length; k <= i; k++) parts = parts.map((n) => Math.ceil(n * 1.5));
  return parts;
}
export const SHOP_REROLL = [2, 3, 5, 7, 11];
export const BOSS_REROLL = [3, 5, 7, 11, 16];
export const PACK_PRICE = 4;
export const ROLLS_PER_ROUND = 4;
export const HAND_LIMIT = 7;
export const ECHO_BREAK = 10;
// Starting resources after setup: 'all' = one card per hex next to BOTH starting settlements,
// 'second' = base-game rule (only the second settlement pays out).
export const SETUP_RESOURCES = 'all';
// Losing streak: if all rolls of a round produce no resources for you, draw a free development card.
export const LOSING_STREAK = true;
// Free settlements (each with a free road) placed at the start of a run. Base game: 2.
export const START_SETTLEMENTS = 4;

export function seqAt(base, i) {
  const a = base.slice();
  while (a.length <= i) a.push(Math.ceil(a[a.length - 1] * 1.5));
  return a[i];
}
