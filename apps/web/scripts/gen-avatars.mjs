#!/usr/bin/env node
// gen-avatars.mjs — bundle a fixed avatar set for Hijack Poker.
//
// Phase 5 ships bundled SVGs only; no user uploads in v1. We use the
// `bottts-neutral` DiceBear style — clean robot heads that read well
// at the small (40-64px) sizes the seat plates use, fit a poker UI's
// neutral palette, and have no faces (avoids any uncanny "this looks
// like a real person" issue at a poker table).
//
// Run from the apps/web/ directory:
//
//   node scripts/gen-avatars.mjs
//
// Output: apps/web/public/avatars/{1..24}.svg + manifest.json. The
// SVGs are small (~2 KB each) and committed to git so they ship from
// the same Vercel CDN as the rest of the app.

import { createAvatar } from '@dicebear/core'
import * as botts from '@dicebear/bottts-neutral'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'avatars')

const COUNT = 24
// Fixed seed list — we want deterministic output so re-running the
// script doesn't produce a different SVG body for the same id.
const SEEDS = Array.from({ length: COUNT }, (_, i) => `hijack-${i + 1}`)

mkdirSync(OUT_DIR, { recursive: true })

const manifest = []
for (let i = 0; i < SEEDS.length; i += 1) {
  const id = String(i + 1)
  const seed = SEEDS[i]
  const avatar = createAvatar(botts, {
    seed,
    size: 96,
    radius: 50,
    backgroundType: ['solid'],
    backgroundColor: ['1f2937', '0f766e', '7c2d12', '4338ca', '92400e', '7c3aed'],
  })
  const svg = avatar.toString()
  const file = resolve(OUT_DIR, `${id}.svg`)
  writeFileSync(file, svg, 'utf8')
  manifest.push({ id, seed, path: `/avatars/${id}.svg` })
}

writeFileSync(
  resolve(OUT_DIR, 'manifest.json'),
  JSON.stringify({ count: COUNT, style: 'bottts-neutral', avatars: manifest }, null, 2),
  'utf8'
)

// eslint-disable-next-line no-console
console.log(`Generated ${COUNT} avatars in ${OUT_DIR}`)
