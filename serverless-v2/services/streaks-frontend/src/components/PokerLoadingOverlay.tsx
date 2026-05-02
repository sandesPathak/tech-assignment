import { useEffect, useMemo, useRef, useState } from 'react'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'

interface Props {
  open: boolean
  onComplete?: () => void
  status?: string
  /** Total ms before onComplete fires. Default 2000. */
  duration?: number
}

const STYLES = `
.pl-overlay {
  position: fixed; inset: 0; z-index: 1500;
  background: radial-gradient(ellipse at center, #0F1117 0%, #050609 80%);
  overflow: hidden;
  animation: pl-in .25s ease-out;
}
.pl-overlay.pl-out { animation: pl-out .35s ease-in forwards; }
@keyframes pl-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes pl-out { from { opacity: 1; } to { opacity: 0; visibility: hidden; } }

.pl-brand {
  position: absolute; top: 7%; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  font-style: italic; font-weight: 900; font-size: 24px; color: #FF6B35;
  letter-spacing: 2px;
  text-shadow: 0 0 20px rgba(255,107,53,0.6);
  opacity: 0; animation: pl-brandIn .4s .10s ease-out forwards;
  white-space: nowrap;
  font-family: Inter, sans-serif;
}
.pl-brand .pl-flame {
  filter: drop-shadow(0 0 12px rgba(255,107,53,0.8));
  animation: pl-flameFlicker 1.4s ease-in-out infinite alternate;
}
@keyframes pl-brandIn { from { opacity: 0; transform: translate(-50%,-10px); } to { opacity: 1; transform: translate(-50%,0); } }
@keyframes pl-flameFlicker {
  0%   { transform: scale(1)    rotate(-2deg); filter: drop-shadow(0 0 8px  rgba(255,107,53,0.6)); }
  100% { transform: scale(1.08) rotate( 2deg); filter: drop-shadow(0 0 16px rgba(255,107,53,0.9)); }
}

.pl-status {
  position: absolute; bottom: 12%; left: 50%; transform: translateX(-50%);
  color: #fff; font-weight: 700; font-size: 16px;
  letter-spacing: 4px; text-transform: uppercase;
  opacity: 0; animation: pl-statusIn .4s .35s ease-out forwards;
  font-family: Inter, sans-serif;
  white-space: nowrap;
}
.pl-status .pl-dots span { animation: pl-blink 1s infinite; }
.pl-status .pl-dots span:nth-child(2) { animation-delay: .2s; }
.pl-status .pl-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes pl-blink     { 0%, 60%, 100% { opacity: 1; } 30% { opacity: .2; } }
@keyframes pl-statusIn  { from { opacity: 0; transform: translate(-50%,10px); } to { opacity: 1; transform: translate(-50%,0); } }

.pl-progress {
  position: absolute; bottom: 9%; left: 50%; transform: translateX(-50%);
  width: min(420px, 60vw); height: 3px; background: rgba(255,255,255,0.08);
  border-radius: 999px; overflow: hidden;
}
.pl-progress::after {
  content: ""; display: block; height: 100%; width: 0;
  background: linear-gradient(90deg, #FF6B35, #FBBF24);
  box-shadow: 0 0 12px rgba(255,107,53,0.6);
  animation: pl-prog 2s linear forwards;
}
@keyframes pl-prog { to { width: 100%; } }

/* Cards */
.pl-pcard { position: absolute; transform-style: preserve-3d; }
.pl-pcard .pl-face, .pl-pcard .pl-back {
  position: absolute; inset: 0; border-radius: 10px;
  -webkit-backface-visibility: hidden; backface-visibility: hidden;
  box-shadow: 0 12px 30px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.06) inset;
}
.pl-face {
  background: linear-gradient(180deg, #FFFFFF 0%, #F4F5F8 100%);
  border: 1px solid #d8d9e0; color: #111; overflow: hidden;
  font-family: Inter, sans-serif;
}
.pl-back {
  transform: rotateY(180deg);
  background:
    repeating-linear-gradient(45deg, #FF6B35 0 8px, #2E1411 8px 16px),
    #2E1411;
  border: 2px solid #FF6B35;
}
.pl-back::after {
  content: ""; position: absolute; inset: 8px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(15,17,23,0.4);
}
.pl-corner { position: absolute; font-weight: 900; line-height: 1; text-align: center; font-family: Inter, sans-serif; }
.pl-corner.pl-tl { top: 8px; left: 8px; }
.pl-corner.pl-br { bottom: 8px; right: 8px; transform: rotate(180deg); }
.pl-corner .pl-rank { font-size: 18px; }
.pl-corner .pl-suit { font-size: 14px; margin-top: 2px; }
.pl-pip { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  font-size: 64px; line-height: 1; }
.pl-red { color: #DC2626; } .pl-black { color: #111; }

.pl-deal-card {
  width: 96px; height: 134px;
  left: 50%; top: 38%;
  margin: -67px 0 0 -48px;
  transform: translate(0,-400px) rotateY(180deg) rotate(-30deg) scale(.6);
  opacity: 0;
  animation: pl-dealSlam 1.4s cubic-bezier(.2,.7,.2,1.2) forwards;
}
@keyframes pl-dealSlam {
  0%   { transform: translate(0,-400px) rotateY(180deg) rotate(-30deg) scale(.6); opacity: 0; }
  20%  { opacity: 1; }
  50%  { transform: translate(var(--tx), 30px) rotateY(180deg) rotate(0deg) scale(1.05); }
  65%  { transform: translate(var(--tx), 0)    rotateY(180deg) rotate(0deg) scale(1); }
  80%  { transform: translate(var(--tx), 0)    rotateY(0deg)   rotate(0deg) scale(1); }
  100% { transform: translate(var(--tx), 0)    rotateY(0deg)   rotate(0deg) scale(1); opacity: 1; }
}

.pl-royal-glow {
  position: absolute; left: 50%; top: 38%;
  width: 720px; height: 220px; margin: -110px 0 0 -360px;
  border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, rgba(255,107,53,0.4), transparent 70%);
  opacity: 0; animation: pl-royalGlow 1.0s 1.40s ease-out forwards;
}
@keyframes pl-royalGlow {
  0%   { opacity: 0; transform: scale(.6); }
  50%  { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.2); }
}

.pl-embers { position: absolute; left: 50%; top: 38%; pointer-events: none; }
.pl-ember {
  position: absolute; width: 4px; height: 4px; border-radius: 50%;
  background: #FF6B35;
  box-shadow: 0 0 8px #FF6B35;
  animation: pl-ember 1.2s ease-out forwards;
  opacity: 0;
}
@keyframes pl-ember {
  0%   { opacity: 0; transform: translate(0,0) scale(.5); }
  20%  { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--ex,0), var(--ey,-200px)) scale(.2); }
}

/* Chips */
.pl-chip {
  position: absolute;
  left: 50%; bottom: 24%;
  width: 110px; height: 32px; margin-left: -55px;
  transform: translateY(800px);
  opacity: 0;
  animation: pl-chipDrop 1.3s cubic-bezier(.2,.8,.2,1) forwards;
  filter: drop-shadow(0 6px 14px rgba(0,0,0,0.55));
}
.pl-chip .pl-side {
  position: absolute; left: 0; right: 0; top: 0; height: 32px;
  border-radius: 50%/50%;
  background: linear-gradient(
    180deg,
    transparent 0%,
    transparent 38%,
    var(--mid) 42%,
    var(--dk)  100%
  );
}
.pl-chip .pl-top {
  position: absolute; left: 0; right: 0; top: 0; height: 22px;
  border-radius: 50%/50%;
  background: radial-gradient(ellipse at 50% 28%, var(--lt) 0%, var(--mid) 55%, var(--dk) 100%);
  overflow: hidden;
}
.pl-chip .pl-wedges {
  position: absolute; inset: 0;
  border-radius: 50%/50%;
  background: conic-gradient(
    from -11.25deg,
    var(--wedge,#fff) 0deg 22.5deg, transparent 22.5deg 45deg,
    var(--wedge,#fff) 45deg 67.5deg, transparent 67.5deg 90deg,
    var(--wedge,#fff) 90deg 112.5deg, transparent 112.5deg 135deg,
    var(--wedge,#fff) 135deg 157.5deg, transparent 157.5deg 180deg,
    var(--wedge,#fff) 180deg 202.5deg, transparent 202.5deg 225deg,
    var(--wedge,#fff) 225deg 247.5deg, transparent 247.5deg 270deg,
    var(--wedge,#fff) 270deg 292.5deg, transparent 292.5deg 315deg,
    var(--wedge,#fff) 315deg 337.5deg, transparent 337.5deg 360deg
  );
  -webkit-mask: radial-gradient(ellipse 58% 58% at center, transparent 0%, transparent 70%, #000 78%, #000 100%);
          mask: radial-gradient(ellipse 58% 58% at center, transparent 0%, transparent 70%, #000 78%, #000 100%);
  opacity: .92;
}
.pl-chip .pl-inlay {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: 56%; height: 60%;
  border-radius: 50%/50%;
  background: radial-gradient(ellipse at 50% 30%, var(--lt) 0%, var(--mid) 90%);
  border: 1px solid rgba(0,0,0,0.18);
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -1px 1px rgba(0,0,0,0.25);
  display: flex; align-items: center; justify-content: center;
  font-family: Inter, sans-serif;
  font-weight: 900;
  color: var(--denom, #fff);
  text-shadow: 0 1px 0 rgba(0,0,0,0.35);
  letter-spacing: -0.5px;
}
.pl-chip .pl-inlay span { font-size: 9px; line-height: 1; transform: scaleY(1.6); display: inline-block; }
@keyframes pl-chipDrop {
  0%   { transform: translateY(800px) rotateZ(-180deg); opacity: 0; }
  15%  { opacity: 1; }
  60%  { transform: translateY(calc(0px - var(--b) + 26px)) rotateZ(0); }
  72%  { transform: translateY(calc(0px - var(--b) - 10px)) rotateZ(0); }
  85%  { transform: translateY(calc(0px - var(--b) + 3px))  rotateZ(0); }
  100% { transform: translateY(calc(0px - var(--b)))        rotateZ(0); opacity: 1; }
}

.pl-counter {
  position: absolute; left: 50%; bottom: 36%; transform: translate(-50%, 0);
  font-size: 56px; font-weight: 900; color: #fff;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 30px rgba(255,107,53,0.7);
  opacity: 0; animation: pl-countIn .25s .15s ease-out forwards;
  letter-spacing: -1px;
  font-family: Inter, sans-serif;
}
@keyframes pl-countIn { from { opacity: 0; transform: translate(-50%,10px); } to { opacity: 1; transform: translate(-50%,0); } }

.pl-burst {
  position: absolute; left: 50%; top: 50%;
  width: 800px; height: 800px; margin: -400px 0 0 -400px;
  border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, rgba(255,107,53,0.45), transparent 70%);
  opacity: 0; transform: scale(.3);
  animation: pl-burst .55s 1.40s ease-out forwards;
}
@keyframes pl-burst {
  0%   { opacity: 0; transform: scale(.3); }
  40%  { opacity: 1; }
  100% { opacity: 0; transform: scale(1.6); }
}

/* Cash + confetti */
.pl-cashpile { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.pl-cash {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%) scale(.5);
  opacity: 0;
  border-radius: 1px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.45);
  will-change: transform, opacity;
  animation: pl-cashFly 1.0s cubic-bezier(.18,.6,.3,1) forwards;
  display: flex; align-items: center; justify-content: center;
  font-family: Inter, sans-serif; font-weight: 900; font-size: 9px;
  color: rgba(255,255,255,0.85);
}
.pl-cash.pl-bill {
  background: linear-gradient(135deg, #16A34A, #15803D);
  border: 1px solid rgba(255,255,255,0.25);
}
.pl-cash.pl-bill::after {
  content: ""; position: absolute; left: 12%; right: 12%; top: 50%; height: 1px;
  background: rgba(255,255,255,0.4);
  transform: translateY(-.5px);
}
.pl-cash.pl-coin { border-radius: 50%; }
.pl-cash.pl-gold { background: radial-gradient(circle at 35% 30%, #FFE8A0, #FBBF24 60%, #B45309 100%); }
.pl-cash.pl-redc { background: radial-gradient(circle at 35% 30%, #FCA5A5, #B91C1C 60%, #450A0A 100%); }
.pl-cash.pl-orangec { background: radial-gradient(circle at 35% 30%, #FFB199, #FF6B35 60%, #B0421B 100%); }
@keyframes pl-cashFly {
  0%   { transform: translate(-50%, -50%) rotate(0deg) scale(.4); opacity: 0; }
  8%   { opacity: 1; }
  50%  { transform: translate(calc(-50% + var(--mx,0px)), calc(-50% + var(--my,0px))) rotate(var(--rot1,360deg)) scale(1); opacity: 1; }
  100% { transform: translate(calc(-50% + var(--fx,0px)), calc(-50% + var(--fy,300px))) rotate(var(--rot2,720deg)) scale(.85); opacity: 0; }
}
`

const CARDS: Array<{ rank: string; suit: '♥'; tx: number; delay: string }> = [
  { rank: '10', suit: '♥', tx: -228, delay: '0.35s' },
  { rank: 'J',  suit: '♥', tx: -114, delay: '0.45s' },
  { rank: 'Q',  suit: '♥', tx:    0, delay: '0.55s' },
  { rank: 'K',  suit: '♥', tx:  114, delay: '0.65s' },
  { rank: 'A',  suit: '♥', tx:  228, delay: '0.75s' },
]

interface ChipDef {
  delay: string
  b: number
  lt: string; mid: string; dk: string
  wedge: string; denom: string
  label: string
  textColor: string
}
const CHIPS: ChipDef[] = [
  { delay: '0.15s', b:  0, lt: '#4B5563', mid: '#111827', dk: '#000000', wedge: '#FFFFFF', denom: '#FFFFFF', label: '100', textColor: '#fff' },
  { delay: '0.25s', b: 14, lt: '#86EFAC', mid: '#15803D', dk: '#052E16', wedge: '#FFFFFF', denom: '#FFFFFF', label: '25',  textColor: '#fff' },
  { delay: '0.35s', b: 28, lt: '#FCA5A5', mid: '#B91C1C', dk: '#450A0A', wedge: '#FFFFFF', denom: '#FFFFFF', label: '5',   textColor: '#fff' },
  { delay: '0.45s', b: 42, lt: '#4B5563', mid: '#111827', dk: '#000000', wedge: '#FFFFFF', denom: '#FFFFFF', label: '100', textColor: '#fff' },
  { delay: '0.55s', b: 56, lt: '#86EFAC', mid: '#15803D', dk: '#052E16', wedge: '#FFFFFF', denom: '#FFFFFF', label: '25',  textColor: '#fff' },
  { delay: '0.65s', b: 70, lt: '#FFFFFF', mid: '#E5E7EB', dk: '#6B7280', wedge: '#DC2626', denom: '#1F2937', label: '1',   textColor: '#1F2937' },
]

function generateEmbers(): Array<React.CSSProperties> {
  return Array.from({ length: 24 }, () => {
    const angle = Math.random() * Math.PI * 2
    const dist = 200 + Math.random() * 300
    return {
      ['--ex' as never]: `${Math.cos(angle) * dist}px`,
      ['--ey' as never]: `${Math.sin(angle) * dist}px`,
      animationDelay: `${1.40 + Math.random() * 0.25}s`,
    } as React.CSSProperties
  })
}

interface CashPiece {
  cls: string
  label: string
  width: number
  height: number
  style: React.CSSProperties
}

function generateCash(): CashPiece[] {
  const PIECES = 56
  const out: CashPiece[] = []
  for (let i = 0; i < PIECES; i += 1) {
    const r = Math.random()
    let cls = 'pl-cash '
    let label = ''
    if (r < 0.55)      { cls += 'pl-bill'; label = '$' }
    else if (r < 0.78) { cls += 'pl-coin pl-gold' }
    else if (r < 0.90) { cls += 'pl-coin pl-redc' }
    else               { cls += 'pl-coin pl-orangec' }

    const angle = Math.random() * Math.PI * 2
    const distMid = 220 + Math.random() * 320
    const mx = Math.cos(angle) * distMid
    const my = Math.sin(angle) * distMid * 0.7 - 60
    const fx = mx + (Math.random() - 0.5) * 80
    const fy = my + 220 + Math.random() * 160
    const rot1 = Math.random() * 720 - 360
    const rot2 = rot1 + (Math.random() * 720 - 360)

    let width: number, height: number
    if (cls.includes('pl-bill')) {
      width = 14 + Math.floor(Math.random() * 10)
      height = width + 6 + Math.floor(Math.random() * 4)
    } else {
      const s = 8 + Math.floor(Math.random() * 8)
      width = s
      height = s
    }

    out.push({
      cls,
      label,
      width,
      height,
      style: {
        ['--mx' as never]: `${mx}px`,
        ['--my' as never]: `${my}px`,
        ['--fx' as never]: `${fx}px`,
        ['--fy' as never]: `${fy}px`,
        ['--rot1' as never]: `${rot1}deg`,
        ['--rot2' as never]: `${rot2}deg`,
        animationDelay: `${1.40 + Math.random() * 0.18}s`,
      } as React.CSSProperties,
    })
  }
  return out
}

export default function PokerLoadingOverlay({
  open,
  onComplete,
  status = 'Taking your seat',
  duration = 2000,
}: Props) {
  const [closing, setClosing] = useState(false)
  const counterRef = useRef<HTMLDivElement | null>(null)
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete

  // Generate randomized particles only once per open cycle so they stay stable
  // across re-renders during the 2s lifetime.
  const seed = open ? 1 : 0
  const embers = useMemo(() => generateEmbers(), [seed])
  const cash = useMemo(() => generateCash(), [seed])

  useEffect(() => {
    if (!open) {
      setClosing(false)
      return
    }
    setClosing(false)
    let raf = 0
    const start = performance.now() + 150
    const target = 1000
    const counterDur = 1500
    function tick(t: number) {
      if (!counterRef.current) return
      if (t < start) {
        raf = requestAnimationFrame(tick)
        return
      }
      const p = Math.min(1, (t - start) / counterDur)
      const eased = 1 - Math.pow(1 - p, 3)
      counterRef.current.textContent = '$' + Math.round(target * eased).toLocaleString()
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const closeAt = setTimeout(() => setClosing(true), Math.max(0, duration - 350))
    const completeAt = setTimeout(() => completeRef.current?.(), duration)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(closeAt)
      clearTimeout(completeAt)
    }
  }, [open, duration])

  if (!open) return null

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className={`pl-overlay${closing ? ' pl-out' : ''}`} role="status" aria-live="polite">
        <div className="pl-brand">
          <LocalFireDepartmentIcon className="pl-flame" sx={{ fontSize: 36, color: '#FF6B35' }} />
          <span>HIJACK POKER</span>
        </div>

        {/* Embers */}
        <div className="pl-embers">
          {embers.map((s, i) => (
            <div key={i} className="pl-ember" style={s} />
          ))}
        </div>

        {/* Royal flush cards */}
        {CARDS.map((c, i) => (
          <div
            key={i}
            className="pl-pcard pl-deal-card"
            style={{ ['--tx' as never]: `${c.tx}px`, animationDelay: c.delay } as React.CSSProperties}
          >
            <div className="pl-back" />
            <div className="pl-face">
              <div className="pl-corner pl-tl pl-red"><div className="pl-rank">{c.rank}</div><div className="pl-suit">{c.suit}</div></div>
              <div className="pl-pip pl-red">{c.suit}</div>
              <div className="pl-corner pl-br pl-red"><div className="pl-rank">{c.rank}</div><div className="pl-suit">{c.suit}</div></div>
            </div>
          </div>
        ))}

        <div className="pl-royal-glow" />

        {/* Counter */}
        <div className="pl-counter" ref={counterRef}>$0</div>

        {/* Chip stack */}
        {CHIPS.map((chip, i) => (
          <div
            key={i}
            className="pl-chip"
            style={{
              ['--b' as never]: `${chip.b}px`,
              ['--lt' as never]: chip.lt,
              ['--mid' as never]: chip.mid,
              ['--dk' as never]: chip.dk,
              ['--wedge' as never]: chip.wedge,
              ['--denom' as never]: chip.denom,
              animationDelay: chip.delay,
            } as React.CSSProperties}
          >
            <div className="pl-side" />
            <div className="pl-top">
              <div className="pl-wedges" />
              <div className="pl-inlay" style={{ color: chip.textColor }}>
                <span>{chip.label}</span>
              </div>
            </div>
          </div>
        ))}

        {/* Final burst */}
        <div className="pl-burst" />

        {/* Cash + confetti explosion */}
        <div className="pl-cashpile">
          {cash.map((p, i) => (
            <div
              key={i}
              className={p.cls}
              style={{ ...p.style, width: p.width, height: p.height }}
            >
              {p.label}
            </div>
          ))}
        </div>

        <div className="pl-status">
          {status}
          <span className="pl-dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
        <div className="pl-progress" />
      </div>
    </>
  )
}
