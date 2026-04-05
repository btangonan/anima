#!/usr/bin/env node
/**
 * generate-buddy.js — Create ~/.config/pixel-terminal/buddy.json
 *
 * Derives a unique persistent companion profile from machine identity.
 * Uses Mulberry32 PRNG seeded from username+hostname — deterministic per machine.
 *
 * Usage:
 *   node scripts/generate-buddy.js          # auto-seed from machine
 *   node scripts/generate-buddy.js --seed 1337   # explicit seed (testing)
 *   node scripts/generate-buddy.js --force  # overwrite existing
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// ── Species + name tables ─────────────────────────────────────────────────────

const SPECIES = [
  'cat', 'rabbit', 'penguin', 'frog', 'axolotl', 'capybara', 'dragon',
  'hamster', 'octopus', 'owl', 'parrot', 'panda', 'fox', 'koala',
  'platypus', 'narwhal', 'sloth', 'hedgehog',
];

const NAMES = {
  dragon:   ['Vexil', 'Pyrax', 'Cindra', 'Scorchus', 'Embrix', 'Drakon'],
  cat:      ['Miso', 'Pixel', 'Glyph', 'Nox', 'Rune', 'Static'],
  rabbit:   ['Qubit', 'Flit', 'Patches', 'Nimble', 'Blip', 'Tempo'],
  penguin:  ['Wadsworth', 'Flint', 'Icarus', 'Pebble', 'Tux', 'Frost'],
  frog:     ['Croak', 'Mossy', 'Boggins', 'Leap', 'Sprig', 'Murk'],
  axolotl:  ['Bubbles', 'Regen', 'Floaty', 'Plume', 'Frond', 'Axe'],
  capybara: ['Chill', 'Gnaw', 'Stoic', 'Mellow', 'Bark', 'Drift'],
  hamster:  ['Spindle', 'Nibble', 'Puff', 'Cheeky', 'Wheel', 'Crisp'],
  octopus:  ['Inky', 'Splat', 'Tentacle', 'Chroma', 'Blotch', 'Swirl'],
  owl:      ['Hoot', 'Grimoire', 'Blink', 'Dusk', 'Rote', 'Ponder'],
  parrot:   ['Echo', 'Squawk', 'Cipher', 'Repeat', 'Lingo', 'Coda'],
  panda:    ['Bamboo', 'Smudge', 'Stout', 'Dozy', 'Patch', 'Monochrome'],
  fox:      ['Rust', 'Wily', 'Dusk', 'Ember', 'Slink', 'Fenn'],
  koala:    ['Gum', 'Drowsy', 'Bark', 'Cradle', 'Laze', 'Snooze'],
  platypus: ['Quill', 'Muddle', 'Beaver', 'Anomaly', 'Spur', 'Ducksworth'],
  narwhal:  ['Tusk', 'Spiral', 'Depth', 'Lance', 'Gloom', 'Brine'],
  sloth:    ['Drape', 'Nap', 'Cling', 'Amble', 'Hangs', 'Algae'],
  hedgehog: ['Spike', 'Bristle', 'Curl', 'Prick', 'Huffle', 'Quill'],
};

// ── Mulberry32 PRNG ───────────────────────────────────────────────────────────

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simple string hash → uint32
function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0;
  }
  return h;
}

// ── Stat generation ───────────────────────────────────────────────────────────

function rollStat(rand) {
  // Roll 2d10 and average — triangular distribution (1–10, peaks around 5–6)
  const a = Math.floor(rand() * 10) + 1;
  const b = Math.floor(rand() * 10) + 1;
  return Math.min(10, Math.max(1, Math.round((a + b) / 2)));
}

// ── Voice key derivation ──────────────────────────────────────────────────────

function getVoiceKey(stats) {
  if (stats.snark >= 7)                            return 'sarcastic';
  if (stats.chaos >= 7)                            return 'excitable';
  if (stats.wisdom >= 7 && stats.snark < 5)        return 'measured';
  if (stats.debugging >= 8)                        return 'technical';
  if (stats.patience <= 3)                         return 'impatient';
  return 'default';
}

// ── Species hue (for potential future tinting) ────────────────────────────────

const SPECIES_HUE = {
  dragon: '#FF4422', cat: '#E8A060', rabbit: '#F0C8D0',
  penguin: '#4499FF', frog: '#44CC44', axolotl: '#FF88BB',
  capybara: '#C8A870', hamster: '#FFD090', octopus: '#9966CC',
  owl: '#AA8844', parrot: '#FF6622', panda: '#AAAAAA',
  fox: '#FF7733', koala: '#88AACC', platypus: '#88AA66',
  narwhal: '#66BBFF', sloth: '#997755', hedgehog: '#AA8866',
};

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const force = args.includes('--force');
const seedIdx = args.indexOf('--seed');
const explicitSeed = seedIdx >= 0 ? parseInt(args[seedIdx + 1]) : null;

const configDir = path.join(os.homedir(), '.config', 'pixel-terminal');
const outPath = path.join(configDir, 'buddy.json');

if (fs.existsSync(outPath) && !force) {
  const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  console.log(`buddy.json already exists: ${existing.name} (${existing.species})`);
  console.log(`Use --force to regenerate.`);
  process.exit(0);
}

fs.mkdirSync(configDir, { recursive: true });

const seed = explicitSeed ?? hashStr(os.userInfo().username + os.hostname());
const rand = mulberry32(seed);

const species = SPECIES[Math.floor(rand() * SPECIES.length)];
const namePool = NAMES[species] || NAMES.cat;
const name = namePool[Math.floor(rand() * namePool.length)];

const stats = {
  debugging: rollStat(rand),
  patience:  rollStat(rand),
  chaos:     rollStat(rand),
  wisdom:    rollStat(rand),
  snark:     rollStat(rand),
};

const profile = {
  species,
  name,
  seed,
  stats,
  voice: getVoiceKey(stats),
  hue: SPECIES_HUE[species] || '#FFFFFF',
  generated: new Date().toISOString().slice(0, 10),
};

fs.writeFileSync(outPath, JSON.stringify(profile, null, 2));
console.log(`Generated buddy profile:`);
console.log(`  Name:    ${profile.name}`);
console.log(`  Species: ${profile.species}`);
console.log(`  Voice:   ${profile.voice}`);
console.log(`  Stats:   D:${stats.debugging} P:${stats.patience} C:${stats.chaos} W:${stats.wisdom} S:${stats.snark}`);
console.log(`  Written: ${outPath}`);
