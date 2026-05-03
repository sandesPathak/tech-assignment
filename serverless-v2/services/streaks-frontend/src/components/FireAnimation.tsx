import { Box } from '@mui/material'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import { useMemo } from 'react'

interface FireAnimationProps {
  size?: number
  containerWidth?: number
}

function FireAnimation({ size = 30, containerWidth = 56 }: FireAnimationProps) {
  const sparks = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        left: 14 + i * 6,
        delay: (i * 0.35) % 1.6,
        duration: 1.6 + (i % 3) * 0.4,
        size: 3 + (i % 3),
      })),
    []
  )

  const ringSize = Math.round(size * 0.95)

  return (
    <Box
      sx={{
        position: 'relative',
        width: containerWidth,
        height: size + 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        flexShrink: 0,
        '@keyframes fireGlow': {
          '0%, 100%': {
            filter:
              'drop-shadow(0 0 6px rgba(249,115,22,0.55)) drop-shadow(0 0 14px rgba(234,88,12,0.35))',
          },
          '50%': {
            filter:
              'drop-shadow(0 0 12px rgba(255,165,0,0.95)) drop-shadow(0 0 24px rgba(249,115,22,0.65))',
          },
        },
        '@keyframes fireFlicker': {
          '0%, 100%': { transform: 'scale(1) rotate(-2deg)', opacity: 1 },
          '20%': { transform: 'scale(1.08) rotate(3deg)', opacity: 0.95 },
          '40%': { transform: 'scale(0.95) rotate(-3deg)', opacity: 1 },
          '60%': { transform: 'scale(1.05) rotate(2deg)', opacity: 0.9 },
          '80%': { transform: 'scale(0.98) rotate(-1deg)', opacity: 1 },
        },
        '@keyframes fireJiggle': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-2px)' },
        },
        '@keyframes sparkRise': {
          '0%': { transform: 'translateY(8px) scale(0.6)', opacity: 0 },
          '20%': { opacity: 1 },
          '100%': { transform: 'translateY(-28px) scale(0.2)', opacity: 0 },
        },
        '@keyframes ringPulse': {
          '0%': { transform: 'translate(-50%,-50%) scale(0.4)', opacity: 0.55 },
          '100%': { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 },
        },
        '@keyframes hueShift': {
          '0%, 100%': { color: '#ff7a18' },
          '50%': { color: '#ffb347' },
        },
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: ringSize,
          height: ringSize,
          borderRadius: '50%',
          border: '1.5px solid rgba(249,115,22,0.6)',
          opacity: 0,
          transform: 'translate(-50%,-50%) scale(0.4)',
          animation: 'ringPulse 2.2s ease-out infinite both',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: ringSize,
          height: ringSize,
          borderRadius: '50%',
          border: '1.5px solid rgba(255,165,0,0.5)',
          opacity: 0,
          transform: 'translate(-50%,-50%) scale(0.4)',
          animation: 'ringPulse 2.2s ease-out 1.1s infinite both',
        }}
      />

      {sparks.map((s, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            bottom: 4,
            left: s.left,
            width: s.size,
            height: s.size,
            borderRadius: '50%',
            bgcolor: i % 2 === 0 ? '#ffb347' : '#ff7a18',
            boxShadow: '0 0 6px rgba(255,165,0,0.85)',
            opacity: 0,
            animation: `sparkRise ${s.duration}s ease-out ${s.delay}s infinite both`,
          }}
        />
      ))}

      <Box
        sx={{
          position: 'relative',
          animation: 'fireJiggle 1.8s ease-in-out infinite',
          display: 'flex',
        }}
      >
        <Box sx={{ animation: 'fireGlow 1.6s ease-in-out infinite', display: 'flex' }}>
          <Box
            sx={{
              animation:
                'fireFlicker 0.8s ease-in-out infinite, hueShift 2.4s ease-in-out infinite',
              transformOrigin: 'bottom center',
              display: 'flex',
            }}
          >
            <LocalFireDepartmentIcon sx={{ fontSize: size }} />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default FireAnimation
