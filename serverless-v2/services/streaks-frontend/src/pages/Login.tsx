import { useState } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  Divider,
  Card,
  CardContent,
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import FireAnimation from '../components/FireAnimation';
import { useAuth } from '../hooks/useAuth';

function Login() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    try {
      setError('');
      setLoading(true);
      await signInWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      setLoading(true);
      if (isSignUp) {
        await signUpWithEmail(email, password, displayName);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setError('Invalid email or password');
      } else if (msg.includes('email-already-in-use')) {
        setError('An account with this email already exists');
      } else if (msg.includes('weak-password')) {
        setError('Password must be at least 6 characters');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#0F1117',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Card
        sx={{
          maxWidth: 420,
          width: '100%',
          bgcolor: '#1A1D27',
          border: '1px solid #2A2D3A',
          borderRadius: 4,
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Logo / Title */}
          <Box display="flex" flexDirection="column" alignItems="center" mb={4}>
            <Box mb={1}>
              <FireAnimation size={56} containerWidth={88} />
            </Box>
            <Typography variant="h5" fontWeight={700} color="#fff">
              Hijack Poker
            </Typography>
            <Typography variant="body2" sx={{ color: '#8B8FA3', mt: 0.5 }}>
              Daily Streaks & Poker
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          {/* Google Sign-In */}
          <Button
            variant="contained"
            fullWidth
            startIcon={<GoogleIcon />}
            onClick={handleGoogle}
            disabled={loading}
            sx={{
              bgcolor: '#fff',
              color: '#333',
              fontWeight: 600,
              textTransform: 'none',
              py: 1.5,
              borderRadius: 3,
              mb: 2,
              '&:hover': { bgcolor: '#f5f5f5' },
            }}
          >
            Continue with Google
          </Button>

          <Divider sx={{ my: 2, borderColor: '#2A2D3A' }}>
            <Typography variant="caption" sx={{ color: '#8B8FA3' }}>
              or
            </Typography>
          </Divider>

          {/* Email/Password Form */}
          <Box component="form" onSubmit={handleEmail} display="flex" flexDirection="column" gap={2}>
            {isSignUp && (
              <TextField
                label="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                fullWidth
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    bgcolor: '#141720',
                    '& fieldset': { borderColor: '#2A2D3A' },
                  },
                }}
              />
            )}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              required
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  bgcolor: '#141720',
                  '& fieldset': { borderColor: '#2A2D3A' },
                },
              }}
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  bgcolor: '#141720',
                  '& fieldset': { borderColor: '#2A2D3A' },
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={loading}
              sx={{
                background: 'linear-gradient(135deg, #FF6B35, #FF4444)',
                fontWeight: 600,
                textTransform: 'none',
                py: 1.5,
                borderRadius: 3,
                '&:hover': { background: 'linear-gradient(135deg, #FF5722, #E53935)' },
              }}
            >
              {isSignUp ? 'Create Account' : 'Sign In'}
            </Button>
          </Box>

          {/* Toggle sign-up/sign-in */}
          <Box display="flex" justifyContent="center" mt={2}>
            <Button
              variant="text"
              onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
              sx={{ color: '#60A5FA', textTransform: 'none', fontSize: 13 }}
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default Login;
