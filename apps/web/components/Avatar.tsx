// Avatar.tsx — shared avatar renderer. Reads `/avatars/<id>.svg` from
// the public directory. Bundled SVG set lives at
// `apps/web/public/avatars/{1..24}.svg` (see `scripts/gen-avatars.mjs`).
//
// The component is intentionally <img>-based rather than `next/image`:
// the SVGs are ~2 KB, already shipped from the same origin, and we
// want zero layout-shift hops through the image optimizer for what
// renders at every seat plate.

import { AVATAR_COUNT, defaultAvatarId, normalizeAvatarId } from '@/lib/profile/avatars'

export interface AvatarProps {
  avatarId: string | number | null | undefined
  size?: number
  alt?: string
  className?: string
}

export function Avatar({ avatarId, size = 48, alt, className }: AvatarProps) {
  const id = normalizeAvatarId(avatarId) ?? defaultAvatarId
  const dim = `${size}px`
  return (
    <img
      src={`/avatars/${id}.svg`}
      width={size}
      height={size}
      alt={alt ?? `Avatar ${id}`}
      className={[
        'rounded-full bg-neutral-800 border border-neutral-700 inline-block',
        className || '',
      ].join(' ')}
      style={{ width: dim, height: dim }}
      loading="lazy"
      decoding="async"
    />
  )
}

export { AVATAR_COUNT }
