import { Box } from '@mui/material'
import Chip, { CHIP_DENOMS } from './Chip'

// Break a dollar amount into chip counts using the standard greedy
// denomination algorithm. We cap each column at 8 chips for visual
// sanity — beyond that we'd just be drawing endless stacks.
function breakdown(amount: number) {
  const out: { value: number; count: number; color: string; edge: string }[] = []
  let rem = Math.max(0, Math.floor(amount))
  for (const d of CHIP_DENOMS) {
    if (rem <= 0) break
    const c = Math.min(8, Math.floor(rem / d.value))
    if (c > 0) {
      out.push({ value: d.value, count: c, color: d.color, edge: d.edge })
      rem -= c * d.value
    }
  }
  return out
}

interface ChipStackProps {
  amount: number
  size?: number
  /** When true, render columns side-by-side; otherwise compact one-column stack. */
  spread?: boolean
}

function ChipStack({ amount, size = 18, spread = false }: ChipStackProps) {
  if (amount <= 0) return null
  const cols = breakdown(amount)
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: spread ? 0.5 : 0.2, position: 'relative' }}>
      {cols.map((col) => (
        <Box key={col.value} sx={{ position: 'relative', width: size, height: size + (col.count - 1) * 4 + 4 }}>
          {Array.from({ length: col.count }).map((_, i) => (
            <Box key={i} sx={{ position: 'absolute', bottom: i * 4, left: 0 }}>
              <Chip color={col.color} edge={col.edge} size={size} label={i === col.count - 1 ? `$${col.value}` : ''} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default ChipStack
