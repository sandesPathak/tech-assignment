import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4CAF50' },
    secondary: { main: '#FFD700' },
    error: { main: '#e53935' },
    background: {
      default: '#0a0e14',
      paper: '#141a22',
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#8B9DAF',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
  },
});
