import { createTheme } from '@mui/material/styles';

export const APP_FONT_STACK = '"Futura", "Futura PT", "Futura Std", "Trebuchet MS", sans-serif';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#FF6B35' },
    secondary: { main: '#7C3AED' },
    success: { main: '#4ADE80' },
    error: { main: '#EF5350' },
    info: { main: '#60A5FA' },
    warning: { main: '#FBBF24' },
    background: {
      default: '#0F1117',
      paper: '#1A1D27',
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#8B8FA3',
    },
    divider: '#2A2D3A',
  },
  typography: {
    fontFamily: APP_FONT_STACK,
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#1A1D27',
          border: '1px solid #2A2D3A',
          borderRadius: 16,
        },
      },
    },
  },
});
