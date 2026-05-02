import { Box } from '@mui/material'

// Casino-standard chip denominations.
export const CHIP_DENOMS = [
  { value: 500, color: '#9C27B0', edge: '#5E35B1' },
  { value: 100, color: '#212121', edge: '#444' },
  { value: 25,  color: '#2E7D32', edge: '#1B5E20' },
  { value: 5,   color: '#C62828', edge: '#8E0000' },
  { value: 1,   color: '#F5F5F5', edge: '#9E9E9E' },
] as const

export interface ChipProps {
  color: string
  edge: string
  size?: number
  label?: string | number
}

function Chip({ color, edge, size = 18, label }: ChipProps) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 30% 30%, ${color}, ${edge})`,
        border: `2px dashed ${edge}`,
        boxShadow: '0 1px 2px rgba(0,0,0,0.6)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.45,
        fontWeight: 700,
        color: color === '#F5F5F5' ? '#444' : '#fff',
        textShadow: '0 1px 0 rgba(0,0,0,0.4)',
        flexShrink: 0,
      }}
    >
      {label}
    </Box>
  )
}

export default Chip
