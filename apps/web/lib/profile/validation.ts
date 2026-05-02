// validation.ts — pure validators for profile updates.
//
// The PATCH /api/profile route runs these checks in a fixed order:
//
//   1. shape       — required string fields, types, lengths
//   2. charset     — display name must match [A-Za-z0-9_]
//   3. profanity   — bad-words filter (run BEFORE write per phase doc)
//   4. avatar      — avatar id is in the bundled set
//   5. rate limit  — Redis: profile:<userId>:lastChange (7d TTL)
//   6. reserved    — Redis: name:reserved:<lower> (30d TTL on old name)
//   7. unique      — Redis: name:taken:<lower> sentinel + Pg fallback
//
// Steps 1-4 are pure and live in this module so the unit tests can
// exercise them without Redis. Steps 5-7 live in `store.ts` where the
// Redis client is injected.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Filter = require('bad-words') as new () => { isProfane: (s: string) => boolean }

const NAME_MIN = 3
const NAME_MAX = 16
const NAME_RE = /^[A-Za-z0-9_]+$/
const AVATAR_COUNT = 24

export type ValidationCode =
  | 'name_required'
  | 'name_too_short'
  | 'name_too_long'
  | 'name_charset'
  | 'name_profane'
  | 'avatar_invalid'

export interface ValidationError {
  code: ValidationCode
  message: string
  field: 'displayName' | 'avatarId'
}

export interface ProfileInput {
  displayName?: unknown
  avatarId?: unknown
}

export interface ValidatedProfileInput {
  displayName: string
  avatarId: string
}

const filterSingleton = (() => {
  let instance: { isProfane: (s: string) => boolean } | null = null
  return () => {
    if (!instance) instance = new Filter()
    return instance
  }
})()

/**
 * Run shape + charset + profanity + avatar checks. Returns the cleaned
 * input on success or a ValidationError on the first failure.
 */
export function validateProfileShape(
  input: ProfileInput
): { ok: true; value: ValidatedProfileInput } | { ok: false; error: ValidationError } {
  const rawName = input.displayName
  if (typeof rawName !== 'string') {
    return errFor('name_required', 'Display name is required.', 'displayName')
  }
  const name = rawName.trim()
  if (name.length === 0) {
    return errFor('name_required', 'Display name is required.', 'displayName')
  }
  if (name.length < NAME_MIN) {
    return errFor(
      'name_too_short',
      `Display name must be at least ${NAME_MIN} characters.`,
      'displayName'
    )
  }
  if (name.length > NAME_MAX) {
    return errFor(
      'name_too_long',
      `Display name must be ${NAME_MAX} characters or fewer.`,
      'displayName'
    )
  }
  if (!NAME_RE.test(name)) {
    return errFor(
      'name_charset',
      'Display name may only contain letters, numbers, and underscores.',
      'displayName'
    )
  }
  // bad-words tokenises on whitespace, so 'shit_eater' wouldn't match.
  // We also test the underscore-replaced and digit-stripped variants
  // so common evasions ('shit_eater', 'shit99') are still caught.
  const filter = filterSingleton()
  const variants = [
    name,
    name.replace(/_/g, ' '),
    name.replace(/[0-9_]/g, ' '),
  ]
  if (variants.some((v) => filter.isProfane(v))) {
    return errFor(
      'name_profane',
      'That display name contains language we don’t allow. Try another.',
      'displayName'
    )
  }
  const rawAvatar = input.avatarId
  if (typeof rawAvatar !== 'string' || rawAvatar.length === 0) {
    return errFor('avatar_invalid', 'Avatar selection is required.', 'avatarId')
  }
  const avatarNum = Number(rawAvatar)
  if (!Number.isInteger(avatarNum) || avatarNum < 1 || avatarNum > AVATAR_COUNT) {
    return errFor(
      'avatar_invalid',
      `Avatar must be one of the ${AVATAR_COUNT} bundled options.`,
      'avatarId'
    )
  }
  return { ok: true, value: { displayName: name, avatarId: String(avatarNum) } }
}

function errFor(
  code: ValidationCode,
  message: string,
  field: 'displayName' | 'avatarId'
): { ok: false; error: ValidationError } {
  return { ok: false, error: { code, message, field } }
}

export const PROFILE_LIMITS = {
  NAME_MIN,
  NAME_MAX,
  NAME_RE,
  AVATAR_COUNT,
}
