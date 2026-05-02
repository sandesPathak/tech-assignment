import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import PokerLoadingOverlay from '../components/PokerLoadingOverlay'

interface LoadingOverlayState {
  /** Trigger the 2s loader and navigate to `to` once the destination has had time to mount. */
  play: (status: string, to: string) => void
}

const Ctx = createContext<LoadingOverlayState>({ play: () => {} })

export function useLoadingOverlay() {
  return useContext(Ctx)
}

/**
 * Provider mounted INSIDE the router so it can call navigate(). Renders the
 * overlay once at the app root so it survives route changes — that way the
 * destination page mounts BEHIND the still-fading overlay and we never flash
 * the source page after the loader.
 */
export function LoadingOverlayProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string>('Loading')
  const [target, setTarget] = useState<string | null>(null)

  const play = useCallback((nextStatus: string, to: string) => {
    setStatus(nextStatus)
    setTarget(to)
    setOpen(true)
  }, [])

  // Fire navigation when the overlay starts fading out — the new route mounts
  // behind the fading overlay so the prior page is never visible.
  const handlePreload = useCallback(() => {
    if (target) navigate(target)
  }, [navigate, target])

  const handleComplete = useCallback(() => {
    setOpen(false)
    setTarget(null)
  }, [])

  return (
    <Ctx.Provider value={{ play }}>
      {children}
      <PokerLoadingOverlay
        open={open}
        status={status}
        onPreload={handlePreload}
        onComplete={handleComplete}
      />
    </Ctx.Provider>
  )
}
