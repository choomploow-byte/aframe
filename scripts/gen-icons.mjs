// Generates src/core/icon-data.ts: the icon set Atelier ships (docs/04 "Icons").
//   - a curated selection of Font Awesome Free solid icons (CC BY 4.0, attribution in
//     THIRD-PARTY-NOTICES.md and in the generated file's header)
//   - the few icons Atelier draws itself (scripts/icons-custom.mjs, MIT)
// Only names listed here are shipped, so the set stays small and consistent.
// Run: node scripts/gen-icons.mjs   (needs the dev dependency @fortawesome/free-solid-svg-icons)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CUSTOM_ICONS, EVENODD } from './icons-custom.mjs';

const require = createRequire(import.meta.url);
const fa = require('@fortawesome/free-solid-svg-icons');
const faVersion = require('@fortawesome/free-solid-svg-icons/package.json').version;

// [name, Font Awesome export, category, search tags]
const FA_ICONS = [
  // ---- game ----
  ['coins', 'Coins', 'game', 'money gold currency cash'],
  ['gem', 'Gem', 'game', 'diamond jewel crystal premium'],
  ['key', 'Key', 'game', 'unlock access'],
  ['shield', 'Shield', 'game', 'defense armor guard protect'],
  ['shield-halved', 'ShieldHalved', 'game', 'defense armor emblem crest'],
  ['shield-heart', 'ShieldHeart', 'game', 'defense health protect'],
  ['star', 'Star', 'game', 'favorite rating xp level rank'],
  ['star-half', 'StarHalfStroke', 'game', 'rating half'],
  ['crown', 'Crown', 'game', 'king vip royal rank leader'],
  ['trophy', 'Trophy', 'game', 'win award achievement cup victory'],
  ['medal', 'Medal', 'game', 'award rank badge achievement'],
  ['skull', 'Skull', 'game', 'death danger enemy defeat'],
  ['skull-crossbones', 'SkullCrossbones', 'game', 'death pirate danger poison'],
  ['heart', 'Heart', 'game', 'health life hp love like'],
  ['heart-crack', 'HeartCrack', 'game', 'broken damage hurt'],
  ['heart-pulse', 'HeartPulse', 'game', 'health vitals heal'],
  ['bolt', 'Bolt', 'game', 'energy lightning power mana speed flash'],
  ['fire', 'Fire', 'game', 'flame hot streak burn'],
  ['flask', 'Flask', 'game', 'potion lab science chemistry'],
  ['scroll', 'Scroll', 'game', 'quest parchment spell mission'],
  ['wand', 'WandSparkles', 'game', 'magic spell staff wizard'],
  ['wand-magic', 'WandMagicSparkles', 'game', 'magic spell wizard'],
  ['hat-wizard', 'HatWizard', 'game', 'mage magic class'],
  ['dragon', 'Dragon', 'game', 'monster boss creature'],
  ['ghost', 'Ghost', 'game', 'spirit enemy halloween'],
  ['bomb', 'Bomb', 'game', 'explosive blast'],
  ['hammer', 'Hammer', 'game', 'build craft forge smith'],
  ['dice', 'Dice', 'game', 'chance random roll'],
  ['dice-d20', 'DiceD20', 'game', 'chance random roll tabletop'],
  ['gamepad', 'Gamepad', 'game', 'controller play games'],
  ['ring', 'Ring', 'game', 'jewelry equipment'],
  ['book', 'Book', 'game', 'journal codex lore'],
  ['book-skull', 'BookSkull', 'game', 'spellbook dark lore'],
  ['map', 'Map', 'game', 'world travel navigation'],
  ['compass', 'Compass', 'game', 'navigation explore direction'],
  ['hourglass', 'Hourglass', 'game', 'time wait cooldown timer'],
  ['crosshairs', 'Crosshairs', 'game', 'aim target scope'],
  ['bullseye', 'Bullseye', 'game', 'target goal aim'],
  ['paw', 'Paw', 'game', 'pet animal companion'],
  ['feather', 'Feather', 'game', 'light quill wing'],
  ['hand-fist', 'HandFist', 'game', 'punch power attack strength'],
  ['clover', 'Clover', 'game', 'luck lucky charm'],
  ['sack-dollar', 'SackDollar', 'game', 'loot money bag gold'],
  ['box-open', 'BoxOpen', 'game', 'loot reward unbox crate'],
  ['gift', 'Gift', 'game', 'reward present bonus'],
  ['flag', 'Flag', 'game', 'objective checkpoint banner'],
  ['flag-checkered', 'FlagCheckered', 'game', 'finish race goal'],
  ['mountain', 'Mountain', 'game', 'world terrain'],
  ['tree', 'Tree', 'game', 'forest nature'],
  ['moon', 'Moon', 'game', 'night dark theme'],
  ['sun', 'Sun', 'game', 'day light theme'],
  ['snowflake', 'Snowflake', 'game', 'ice frost cold'],
  ['droplet', 'Droplet', 'game', 'water mana liquid'],
  ['leaf', 'Leaf', 'game', 'nature herb plant'],
  ['anchor', 'Anchor', 'game', 'sea ship'],
  ['cube', 'Cube', 'game', 'block 3d item'],
  ['puzzle-piece', 'PuzzlePiece', 'game', 'piece extension plugin'],
  // ---- commerce ----
  ['store', 'Store', 'commerce', 'shop market'],
  ['bag-shopping', 'BagShopping', 'commerce', 'shop buy purchase'],
  ['cart-shopping', 'CartShopping', 'commerce', 'shop buy basket checkout'],
  ['credit-card', 'CreditCard', 'commerce', 'payment pay card'],
  ['tag', 'Tag', 'commerce', 'price label sale'],
  ['tags', 'Tags', 'commerce', 'prices labels'],
  ['receipt', 'Receipt', 'commerce', 'invoice bill'],
  ['wallet', 'Wallet', 'commerce', 'money pay'],
  ['percent', 'Percent', 'commerce', 'discount sale'],
  ['award', 'Award', 'commerce', 'badge prize quality'],
  ['ticket', 'Ticket', 'commerce', 'pass event coupon'],
  // ---- interface ----
  ['xmark', 'Xmark', 'ui', 'close cancel dismiss remove delete x'],
  ['check', 'Check', 'ui', 'done ok confirm tick accept'],
  ['gear', 'Gear', 'ui', 'settings preferences options cog'],
  ['plus', 'Plus', 'ui', 'add new create'],
  ['minus', 'Minus', 'ui', 'remove subtract less'],
  ['bars', 'Bars', 'ui', 'menu hamburger navigation'],
  ['house', 'House', 'ui', 'home start main'],
  ['user', 'User', 'ui', 'person profile account avatar'],
  ['users', 'Users', 'ui', 'people team group party friends'],
  ['bell', 'Bell', 'ui', 'notification alert alarm'],
  ['magnifying-glass', 'MagnifyingGlass', 'ui', 'search find zoom'],
  ['trash', 'TrashCan', 'ui', 'delete remove bin'],
  ['pen', 'Pen', 'ui', 'edit write draw'],
  ['pencil', 'Pencil', 'ui', 'edit write'],
  ['copy', 'Copy', 'ui', 'duplicate clone'],
  ['floppy-disk', 'FloppyDisk', 'ui', 'save store'],
  ['eye', 'Eye', 'ui', 'view show visible'],
  ['eye-slash', 'EyeSlash', 'ui', 'hide hidden invisible'],
  ['lock', 'Lock', 'ui', 'secure private locked'],
  ['unlock', 'Unlock', 'ui', 'open unlocked'],
  ['circle', 'Circle', 'ui', 'dot radio shape'],
  ['square', 'Square', 'ui', 'box shape'],
  ['list', 'List', 'ui', 'menu items bullets'],
  ['sliders', 'Sliders', 'ui', 'adjust filters controls settings'],
  ['filter', 'Filter', 'ui', 'funnel narrow'],
  ['ellipsis', 'Ellipsis', 'ui', 'more menu dots'],
  ['grip', 'Grip', 'ui', 'drag handle grid'],
  ['bookmark', 'Bookmark', 'ui', 'save favorite'],
  ['thumbs-up', 'ThumbsUp', 'ui', 'like approve good'],
  ['comment', 'Comment', 'ui', 'chat message talk'],
  ['envelope', 'Envelope', 'ui', 'mail email message'],
  ['phone', 'Phone', 'ui', 'call contact'],
  ['location-dot', 'LocationDot', 'ui', 'pin place map marker'],
  ['globe', 'Globe', 'ui', 'world web language'],
  ['link', 'Link', 'ui', 'chain url attach'],
  ['calendar', 'Calendar', 'ui', 'date schedule event'],
  ['clock', 'Clock', 'ui', 'time hour'],
  ['image', 'Image', 'ui', 'photo picture'],
  ['camera', 'Camera', 'ui', 'photo capture'],
  ['video', 'Video', 'ui', 'film record'],
  ['music', 'Music', 'ui', 'audio song sound'],
  ['volume-high', 'VolumeHigh', 'ui', 'sound audio speaker loud'],
  ['volume-xmark', 'VolumeXmark', 'ui', 'mute sound off'],
  ['wifi', 'Wifi', 'ui', 'network signal'],
  ['battery-full', 'BatteryFull', 'ui', 'power charge'],
  ['lightbulb', 'Lightbulb', 'ui', 'idea tip hint'],
  ['rocket', 'Rocket', 'ui', 'launch boost fast'],
  ['palette', 'Palette', 'ui', 'color theme paint'],
  ['code', 'Code', 'ui', 'developer programming'],
  ['terminal', 'Terminal', 'ui', 'console command'],
  ['wrench', 'Wrench', 'ui', 'tool fix repair'],
  ['chart-line', 'ChartLine', 'ui', 'analytics growth stats'],
  ['chart-pie', 'ChartPie', 'ui', 'analytics share stats'],
  ['gauge', 'Gauge', 'ui', 'speed meter dashboard'],
  ['share', 'Share', 'ui', 'send export'],
  ['download', 'Download', 'ui', 'save get'],
  ['upload', 'Upload', 'ui', 'send put'],
  ['rotate', 'Rotate', 'ui', 'refresh reload turn'],
  ['arrows-rotate', 'ArrowsRotate', 'ui', 'refresh sync reload'],
  ['shuffle', 'Shuffle', 'ui', 'random mix'],
  ['expand', 'Expand', 'ui', 'fullscreen enlarge'],
  ['compress', 'Compress', 'ui', 'shrink smaller'],
  ['ban', 'Ban', 'ui', 'forbidden blocked disabled'],
  ['plug', 'Plug', 'ui', 'connect power integration'],
  ['handshake', 'Handshake', 'ui', 'deal partner trade'],
  ['hand', 'Hand', 'ui', 'stop palm'],
  // ---- status ----
  ['circle-info', 'CircleInfo', 'status', 'information help about'],
  ['circle-question', 'CircleQuestion', 'status', 'help unknown faq'],
  ['circle-check', 'CircleCheck', 'status', 'success done complete'],
  ['circle-xmark', 'CircleXmark', 'status', 'error failed close'],
  ['circle-plus', 'CirclePlus', 'status', 'add new'],
  ['circle-minus', 'CircleMinus', 'status', 'remove'],
  ['triangle-exclamation', 'TriangleExclamation', 'status', 'warning alert caution danger'],
  ['play', 'Play', 'status', 'start media run'],
  ['pause', 'Pause', 'status', 'media hold'],
  ['forward', 'Forward', 'status', 'next skip media'],
  ['backward', 'Backward', 'status', 'previous media'],
  // ---- arrows ----
  ['arrow-up', 'ArrowUp', 'arrows', 'up north'],
  ['arrow-down', 'ArrowDown', 'arrows', 'down south'],
  ['arrow-left', 'ArrowLeft', 'arrows', 'left back previous'],
  ['arrow-right', 'ArrowRight', 'arrows', 'right next forward'],
  ['arrow-right-long', 'ArrowRightLong', 'arrows', 'right long next'],
  ['chevron-up', 'ChevronUp', 'arrows', 'up expand collapse'],
  ['chevron-down', 'ChevronDown', 'arrows', 'down expand dropdown'],
  ['chevron-left', 'ChevronLeft', 'arrows', 'left back previous'],
  ['chevron-right', 'ChevronRight', 'arrows', 'right next forward'],
  ['caret-up', 'CaretUp', 'arrows', 'up sort'],
  ['caret-down', 'CaretDown', 'arrows', 'down sort dropdown'],
  ['caret-left', 'CaretLeft', 'arrows', 'left'],
  ['caret-right', 'CaretRight', 'arrows', 'right'],
  ['arrows-up-down-left-right', 'ArrowsUpDownLeftRight', 'arrows', 'move drag all directions'],
  ['arrow-up-right-from-square', 'ArrowUpRightFromSquare', 'arrows', 'external open new link'],
];

const names = new Set();
const out = [];

for (const [name, key, category, tags] of FA_ICONS) {
  const icon = fa[`fa${key}`];
  if (!icon) throw new Error(`Font Awesome Free has no icon fa${key} (for "${name}")`);
  if (names.has(name)) throw new Error(`duplicate icon name ${name}`);
  names.add(name);
  const [w, h, , , d] = icon.icon;
  if (typeof d !== 'string') throw new Error(`${name}: expected one path`);
  out.push({ name, category, tags, vb: [w, h], d, source: 'fontawesome-free' });
}
for (const [name, def] of Object.entries(CUSTOM_ICONS)) {
  if (names.has(name)) throw new Error(`duplicate icon name ${name}`);
  names.add(name);
  out.push({
    name,
    category: def.category,
    tags: def.tags,
    vb: [512, 512],
    d: def.d,
    ...(EVENODD.has(name) ? { rule: 'evenodd' } : {}),
    source: 'atelier',
  });
}
out.sort((a, b) => a.name.localeCompare(b.name));

const body = out
  .map(
    (i) =>
      `  { name: ${JSON.stringify(i.name)}, category: ${JSON.stringify(i.category)}, tags: ${JSON.stringify(i.tags)}, vb: [${i.vb[0]}, ${i.vb[1]}], ${i.rule ? `rule: 'evenodd', ` : ''}source: ${JSON.stringify(i.source)}, d: ${JSON.stringify(i.d)} },`,
  )
  .join('\n');

const file = `/*!
 * GENERATED by scripts/gen-icons.mjs. Do not edit by hand.
 *
 * Icons with source "fontawesome-free" are from Font Awesome Free ${faVersion} (solid),
 * Copyright Fonticons, Inc., https://fontawesome.com, licensed CC BY 4.0
 * (https://creativecommons.org/licenses/by/4.0/). They are unmodified apart from the selection.
 * Icons with source "atelier" were drawn for this project and are MIT licensed.
 */
import type { IconDef } from './icons';

export const ICON_DATA: readonly IconDef[] = [
${body}
];
`;

writeFileSync('src/core/icon-data.ts', file);
console.log(
  `wrote src/core/icon-data.ts (${out.length} icons, ${Math.round(file.length / 1024)} KB)`,
);
