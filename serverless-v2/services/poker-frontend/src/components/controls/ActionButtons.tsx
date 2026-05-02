import { Box, Button, Typography } from '@mui/material';
import type { GameState, Player } from '../../types/poker.types';

interface ActionButtonsProps {
  game?: GameState;
  players?: Player[];
  onAction?: (seat: number, action: string, amount?: number) => void;
}

function ActionButtons({ game, players, onAction }: ActionButtonsProps) {
  if (!game || !players || !onAction) {
    return (
      <Box display="flex" gap={1} justifyContent="center" sx={{ opacity: 0.3 }}>
        <Button variant="contained" disabled sx={{ bgcolor: '#78909C', fontWeight: 700, textTransform: 'none', borderRadius: 2, minWidth: 90 }}>Fold</Button>
        <Button variant="contained" disabled sx={{ bgcolor: '#2196F3', fontWeight: 700, textTransform: 'none', borderRadius: 2, minWidth: 90 }}>Call</Button>
        <Button variant="contained" disabled sx={{ bgcolor: '#FF9800', fontWeight: 700, textTransform: 'none', borderRadius: 2, minWidth: 90 }}>Raise</Button>
        <Button variant="contained" disabled sx={{ bgcolor: '#e53935', fontWeight: 700, textTransform: 'uppercase', borderRadius: 2, minWidth: 90 }}>All In</Button>
      </Box>
    );
  }

  const actingSeat = game.move;
  const actingPlayer = players.find((p) => p.seat === actingSeat && p.status === '1');
  const isBettingStep = game.stepName.includes('BETTING');
  const toCall = actingPlayer ? Math.max(0, game.currentBet - actingPlayer.bet) : 0;
  const canAct = isBettingStep && actingPlayer;
  const minRaise = Math.max(game.currentBet * 2, (game.lastRaiseSize || game.bigBlind) + game.currentBet);

  const handleAction = (action: string, amount?: number) => {
    if (!actingPlayer) return;
    onAction(actingPlayer.seat, action, amount);
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
      {canAct && (
        <Typography sx={{ fontSize: 12, color: '#90CAF9', fontWeight: 600 }}>
          {actingPlayer.username}&apos;s turn (Seat {actingSeat}) — {toCall > 0 ? `$${toCall.toFixed(2)} to call` : 'Check or Bet'}
        </Typography>
      )}
      <Box display="flex" gap={1} justifyContent="center">
        <Button
          variant="contained"
          onClick={() => handleAction('fold')}
          disabled={!canAct}
          sx={{ bgcolor: '#546E7A', '&:hover': { bgcolor: '#455A64' }, fontWeight: 700, textTransform: 'none', borderRadius: 2, minWidth: 90 }}
        >
          Fold
        </Button>
        {toCall === 0 ? (
          <Button
            variant="contained"
            onClick={() => handleAction('check')}
            disabled={!canAct}
            sx={{ bgcolor: '#2E7D32', '&:hover': { bgcolor: '#1B5E20' }, fontWeight: 700, textTransform: 'none', borderRadius: 2, minWidth: 90 }}
          >
            Check
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => handleAction('call')}
            disabled={!canAct}
            sx={{ bgcolor: '#1565C0', '&:hover': { bgcolor: '#0D47A1' }, fontWeight: 700, textTransform: 'none', borderRadius: 2, minWidth: 90 }}
          >
            Call ${toCall.toFixed(0)}
          </Button>
        )}
        <Button
          variant="contained"
          onClick={() => handleAction(game.currentBet === 0 ? 'bet' : 'raise', minRaise)}
          disabled={!canAct || !actingPlayer || actingPlayer.stack <= toCall}
          sx={{ bgcolor: '#E65100', '&:hover': { bgcolor: '#BF360C' }, fontWeight: 700, textTransform: 'none', borderRadius: 2, minWidth: 90 }}
        >
          {game.currentBet === 0 ? `Bet $${game.bigBlind}` : `Raise $${minRaise}`}
        </Button>
        <Button
          variant="contained"
          onClick={() => handleAction('allin')}
          disabled={!canAct}
          sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, fontWeight: 700, textTransform: 'uppercase', borderRadius: 2, minWidth: 90 }}
        >
          All In
        </Button>
      </Box>
    </Box>
  );
}

export default ActionButtons;
