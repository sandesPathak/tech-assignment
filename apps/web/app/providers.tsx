'use client'

import { useEffect } from 'react'
import { initWebTracing } from '@/lib/tracing'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initWebTracing().catch(() => { /* no-op */ })
  }, [])
  return <>{children}</>
}
