import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './hooks/useAuth';
import { ToastProvider } from './context/ToastContext';
import Dashboard from './pages/Dashboard';
import PokerGame from './pages/PokerGame';
import PokerLobby from './pages/PokerLobby';
import AdminDashboard from './pages/AdminDashboard';
import AdminPlayerHistory from './pages/AdminPlayerHistory';
import Login from './pages/Login';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <ToastProvider>
        <Box sx={{ minHeight: '100vh', bgcolor: '#0F1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress sx={{ color: '#FF6B35' }} />
        </Box>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {user ? (
            <>
              <Route path="/" element={<Dashboard />} />
              <Route path="/play" element={<PokerGame />} />
              <Route path="/lobby" element={<PokerLobby />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/players" element={<AdminPlayerHistory />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
              <Route path="*" element={<Login />} />
            </>
          )}
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
