export const lobbyPalette = {
  bg: '#0F1117',
  surface: 'rgba(16,18,27,0.82)',
  surfaceSoft: 'rgba(20,23,32,0.88)',
  surfaceMuted: '#141720',
  border: '#2A2D3A',
  text: '#FFFFFF',
  textDim: '#8B8FA3',
  orange: '#FF6B35',
  orangeDeep: '#FF7A1F',
  purple: '#A78BFA',
  blue: '#60A5FA',
  gold: '#FBBF24',
  green: '#4ADE80',
  red: '#EF5350',
};

export const lobbyPageSx = {
  position: 'relative',
  minHeight: '100vh',
  bgcolor: lobbyPalette.bg,
  color: lobbyPalette.text,
  py: { xs: 3, md: 4 },
  px: { xs: 2, md: 4 },
  overflow: 'hidden',
  '&::before': {
    content: '""',
    position: 'fixed',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    background:
      'radial-gradient(900px 520px at 12% 0%, rgba(255,107,53,0.14), transparent 60%),' +
      'radial-gradient(860px 540px at 88% 0%, rgba(124,58,237,0.12), transparent 60%),' +
      'radial-gradient(1100px 620px at 50% 110%, rgba(255,179,0,0.08), transparent 72%)',
  },
  '&::after': {
    content: '""',
    position: 'fixed',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    opacity: 0.2,
    background:
      'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
    backgroundSize: '140px 140px',
    maskImage: 'radial-gradient(circle at center, black 48%, transparent 100%)',
  },
  '& > *': {
    position: 'relative',
    zIndex: 1,
  },
};

export const lobbyHeroSx = {
  position: 'relative',
  overflow: 'hidden',
  borderRadius: 4,
  p: { xs: 2.5, md: 3 },
  mb: 4,
  border: `1px solid ${lobbyPalette.border}`,
  background:
    'linear-gradient(135deg, rgba(15,23,42,0.92) 0%, rgba(11,19,38,0.88) 48%, rgba(255,107,53,0.18) 100%)',
  boxShadow: '0 16px 38px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    opacity: 0.38,
    background:
      'radial-gradient(circle at 18% 24%, rgba(255,107,53,0.42), transparent 48%), radial-gradient(circle at 82% 72%, rgba(124,58,237,0.26), transparent 48%)',
  },
};

export function createLobbyPanelSx(accent = lobbyPalette.orange) {
  return {
    position: 'relative',
    overflow: 'hidden',
    height: '100%',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
    bgcolor: lobbyPalette.surface,
    border: `1px solid ${lobbyPalette.border}`,
    borderRadius: 4,
    boxShadow: '0 16px 34px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04)',
    transition: 'transform .22s ease, border-color .22s ease, box-shadow .22s ease',
    '&:hover': {
      transform: 'translateY(-3px)',
      borderColor: `${accent}55`,
      boxShadow: `0 20px 38px rgba(0,0,0,0.42), 0 0 0 1px ${accent}22`,
    },
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      background: `radial-gradient(closest-side at 100% 0%, ${accent}22, transparent 72%)`,
      opacity: 0.9,
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.015), transparent 24%)',
    },
  };
}

export function createLobbyIconTileSx(accent: string, background: string) {
  return {
    width: 64,
    height: 64,
    borderRadius: 4,
    background,
    border: `1px solid ${accent}44`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: `0 0 18px ${accent}24, inset 0 1px 0 rgba(255,255,255,0.05)`,
  };
}

export function createLobbyInsetSx(accent: string, background = 'rgba(12,14,22,0.76)') {
  return {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 3,
    bgcolor: background,
    border: `1px solid ${accent}2F`,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      background: `linear-gradient(180deg, ${accent}, ${accent}99)`,
      boxShadow: `0 0 10px ${accent}66`,
    },
  };
}

export function createLobbyPillSx(color: string, background = 'rgba(255,255,255,0.04)') {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 26,
    px: 1.25,
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 700,
    color,
    bgcolor: background,
    border: `1px solid ${color}44`,
    borderRadius: 999,
  };
}
