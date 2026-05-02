// Server component — public profile view. Reads the player's bundled
// avatar + display name from /api/profile/[id] (resolved via the same
// Pg/Redis store the settings page writes to).

import { Avatar } from '@/components/Avatar'
import { readProfile } from '@/lib/profile/store'
import { getRedis, getPg } from '@/lib/profile/clients'

interface Props {
  params: { id: string }
}

export default async function ProfilePage({ params }: Props) {
  const userId = decodeURIComponent(params.id)
  const profile = await readProfile(userId, { redis: getRedis(), pg: getPg() })

  const displayName = profile?.displayName || userId
  const avatarId = profile?.avatarId || '1'

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <header className="flex items-center gap-4 mb-6">
        <Avatar avatarId={avatarId} size={96} alt={`${displayName} avatar`} />
        <div>
          <h1 className="text-2xl font-bold">{displayName}</h1>
          <p className="text-xs text-neutral-500 font-mono">{userId}</p>
        </div>
      </header>
      <dl className="rounded-md border border-neutral-800 p-4 text-sm space-y-1">
        <div className="flex gap-2">
          <dt className="text-neutral-500 w-32">Avatar</dt>
          <dd className="text-neutral-200">#{avatarId}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-neutral-500 w-32">Joined</dt>
          <dd className="text-neutral-200">
            {profile?.createdAt
              ? new Date(profile.createdAt).toLocaleDateString()
              : '—'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-neutral-500 w-32">Last name change</dt>
          <dd className="text-neutral-200">
            {profile?.displayNameChangedAt
              ? new Date(profile.displayNameChangedAt).toLocaleString()
              : 'Never'}
          </dd>
        </div>
      </dl>
    </main>
  )
}
