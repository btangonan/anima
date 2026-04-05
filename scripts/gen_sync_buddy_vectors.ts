#!/usr/bin/env bun
/**
 * gen_sync_buddy_vectors.ts — Generate test vectors for sync_buddy Rust parity tests.
 *
 * Runs the exact rollBones + deriveVoice logic from sync_real_buddy.ts against
 * 1000 deterministic UUIDs and writes JSON fixtures to:
 *   src-tauri/tests/fixtures/sync_buddy_vectors.json
 *
 * Usage: bun scripts/gen_sync_buddy_vectors.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SALT = 'friend-2026-401';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RARITIES = [
  { name: 'Common',    weight: 60, floor: 5,  peakMin: 55,  peakMax: 84,  dumpMin: 1,  dumpMax: 19 },
  { name: 'Uncommon',  weight: 25, floor: 15, peakMin: 65,  peakMax: 94,  dumpMin: 5,  dumpMax: 29 },
  { name: 'Rare',      weight: 10, floor: 25, peakMin: 75,  peakMax: 100, dumpMin: 15, dumpMax: 39 },
  { name: 'Epic',      weight: 4,  floor: 35, peakMin: 85,  peakMax: 100, dumpMin: 25, dumpMax: 49 },
  { name: 'Legendary', weight: 1,  floor: 50, peakMin: 100, peakMax: 100, dumpMin: 40, dumpMax: 64 },
];

const SPECIES = [
  'duck','goose','blob','cat','dragon','octopus','owl','penguin',
  'turtle','snail','ghost','axolotl','capybara','cactus','robot',
  'rabbit','mushroom','chonk',
];

const EYES = ['dot','star','x','circle','at','degree'];
const HATS = ['none','crown','tophat','propeller','halo','wizard','beanie','tinyduck'];
const STATS = ['debugging','patience','chaos','wisdom','snark'];

function rollBones(uuid: string) {
  const seed = Number(BigInt(Bun.hash(uuid + SALT)) & 0xFFFFFFFFn) >>> 0;
  const rand = mulberry32(seed);

  const totalWeight = RARITIES.reduce((s, r) => s + r.weight, 0);
  let rarityRoll = rand() * totalWeight;
  let rarity = RARITIES[0];
  for (const r of RARITIES) { rarityRoll -= r.weight; if (rarityRoll <= 0) { rarity = r; break; } }

  const species = SPECIES[Math.floor(rand() * SPECIES.length)];
  const eyes = EYES[Math.floor(rand() * EYES.length)];
  const hat = rarity.name === 'Common' ? 'none' : HATS[Math.floor(rand() * HATS.length)];
  const shiny = rand() < 0.01;

  const peakIdx = Math.floor(rand() * STATS.length);
  let dumpIdx   = Math.floor(rand() * (STATS.length - 1));
  if (dumpIdx >= peakIdx) dumpIdx++;

  const stats: Record<string, number> = {};
  for (let i = 0; i < STATS.length; i++) {
    let raw: number;
    if (i === peakIdx) {
      raw = rarity.peakMin === rarity.peakMax
        ? rarity.peakMin
        : Math.floor(rand() * (rarity.peakMax - rarity.peakMin + 1)) + rarity.peakMin;
    } else if (i === dumpIdx) {
      raw = Math.floor(rand() * (rarity.dumpMax - rarity.dumpMin + 1)) + rarity.dumpMin;
    } else {
      raw = Math.floor(rand() * (100 - rarity.floor + 1)) + rarity.floor;
    }
    stats[STATS[i]] = Math.max(1, Math.min(10, Math.round(raw / 10)));
  }

  return { rarity: rarity.name, species, eyes, hat, shiny, stats };
}

function deriveVoice(stats: Record<string, number>): string {
  if (stats.snark >= 7)                          return 'sarcastic';
  if (stats.chaos >= 7)                          return 'excitable';
  if (stats.wisdom >= 7 && stats.snark < 5)     return 'measured';
  if (stats.debugging >= 8)                      return 'technical';
  if (stats.patience <= 3)                       return 'impatient';
  return 'default';
}

// ── Generate 1000 vectors ─────────────────────────────────────────────────────

// Deterministic UUID-like inputs: 500 v4-style UUIDs + 500 edge cases
const vectors: Array<{ uuid: string; seed: number; bones: ReturnType<typeof rollBones>; voice: string }> = [];

// Reproducible UUID generation using a simple LCG (not crypto — just deterministic variety)
function fakeUuid(n: number): string {
  const h = (n * 2654435761 >>> 0).toString(16).padStart(8, '0');
  const h2 = ((n * 1664525 + 1013904223) >>> 0).toString(16).padStart(8, '0');
  return `${h.slice(0,8)}-${h2.slice(0,4)}-4${h.slice(1,4)}-${h2.slice(4,8)}-${h.slice(0,12)}`;
}

for (let i = 0; i < 950; i++) {
  const uuid = fakeUuid(i);
  const seed = Number(BigInt(Bun.hash(uuid + SALT)) & 0xFFFFFFFFn) >>> 0;
  const bones = rollBones(uuid);
  const voice = deriveVoice(bones.stats);
  vectors.push({ uuid, seed, bones, voice });
}

// Edge cases: empty string, 'anon', short, long, unicode-adjacent
const edgeCases = [
  'anon',
  '',
  'a',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '12345678-1234-1234-1234-123456789abc',
  'user-test-uuid-for-parity-validation',
  'bradley-tangonan-pixel-terminal-2026',
  'x'.repeat(64),
  '0',
];
for (const uuid of edgeCases) {
  const seed = Number(BigInt(Bun.hash(uuid + SALT)) & 0xFFFFFFFFn) >>> 0;
  const bones = rollBones(uuid);
  const voice = deriveVoice(bones.stats);
  vectors.push({ uuid, seed, bones, voice });
}

// Validate we have 1000
while (vectors.length < 1000) {
  const uuid = fakeUuid(vectors.length + 10000);
  const seed = Number(BigInt(Bun.hash(uuid + SALT)) & 0xFFFFFFFFn) >>> 0;
  const bones = rollBones(uuid);
  const voice = deriveVoice(bones.stats);
  vectors.push({ uuid, seed, bones, voice });
}

// ── Write fixture ─────────────────────────────────────────────────────────────

const outDir = join(import.meta.dir, '..', 'src-tauri', 'tests', 'fixtures');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'sync_buddy_vectors.json');
writeFileSync(outPath, JSON.stringify({ salt: SALT, vectors }, null, 2));

console.log(`[gen-vectors] wrote ${vectors.length} vectors → ${outPath}`);

// Quick sanity: rarity distribution
const dist: Record<string, number> = {};
for (const v of vectors) dist[v.bones.rarity] = (dist[v.bones.rarity] ?? 0) + 1;
console.log('[gen-vectors] rarity dist:', dist);
