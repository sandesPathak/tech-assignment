import { Box, Button, ButtonGroup, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SpeedIcon from '@mui/icons-material/Speed';

interface GameControlsProps {
  onNextStep: () => void;
  onToggleAuto: () => void;
  onCycleSpeed: () => void;
  onReset: () => void;
  isPlaying: boolean;
  speedLabel: string;
  disabled?: boolean;
}

function GameControls({
  onNextStep,
  onToggleAuto,
  onCycleSpeed,
  onReset,
  isPlaying,
  speedLabel,
  disabled,
}: GameControlsProps) {
  return (
    <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap" justifyContent="center">
      <Button
        variant="contained"
        startIcon={<SkipNextIcon />}
        onClick={onNextStep}
        disabled={disabled || isPlaying}
        data-testid="btn-next-step"
        sx={{
          bgcolor: '#2E7D32',
          '&:hover': { bgcolor: '#1B5E20' },
          fontWeight: 700,
          textTransform: 'none',
          borderRadius: 2,
        }}
      >
        Next Step
      </Button>

      <Button
        variant="contained"
        startIcon={isPlaying ? <StopIcon /> : <PlayArrowIcon />}
        onClick={onToggleAuto}
        disabled={disabled}
        data-testid="btn-auto-play"
        sx={{
          bgcolor: isPlaying ? '#C62828' : '#1565C0',
          '&:hover': { bgcolor: isPlaying ? '#B71C1C' : '#0D47A1' },
          fontWeight: 700,
          textTransform: 'none',
          borderRadius: 2,
        }}
      >
        {isPlaying ? 'Stop' : 'Auto Play'}
      </Button>

      <ButtonGroup variant="outlined" size="small">
        <Button
          startIcon={<SpeedIcon />}
          onClick={onCycleSpeed}
          data-testid="btn-speed"
          sx={{
            color: '#90CAF9',
            borderColor: '#37474F',
            textTransform: 'none',
            fontWeight: 600,
          }}
        >
          {speedLabel}
        </Button>
      </ButtonGroup>

      <Button
        variant="outlined"
        startIcon={<RestartAltIcon />}
        onClick={onReset}
        disabled={disabled}
        data-testid="btn-reset"
        sx={{
          color: '#B0BEC5',
          borderColor: '#37474F',
          '&:hover': { borderColor: '#546E7A', bgcolor: '#263238' },
          fontWeight: 600,
          textTransform: 'none',
          borderRadius: 2,
        }}
      >
        Reset
      </Button>
    </Box>
  );
}

export default GameControls;
