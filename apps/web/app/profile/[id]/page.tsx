// Server component — placeholder profile view. Phase 5 will turn this
// into the avatar/details viewer. We keep it minimal so the route
// exists for deep links from the table.

interface Props {
  params: { id: string }
}

export default function ProfilePage({ params }: Props) {
  const userId = decodeURIComponent(params.id)
  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Profile</h1>
      <p className="text-neutral-400 text-sm mb-6">
        Phase 5 will add avatars and stats.
      </p>
      <dl className="rounded-md border border-neutral-800 p-4 text-sm">
        <div className="flex gap-2">
          <dt className="text-neutral-500 w-24">User ID</dt>
          <dd className="text-neutral-200 font-mono">{userId}</dd>
        </div>
      </dl>
    </main>
  )
}
