import { Box, Button, Typography } from '@mui/material';
import type { GameState, Player } from '../../../types/poker.types';

interface ActionButtonsProps {
  game?: GameState;
  players?: Player[];
  onAction?: (seat: number, action: string, amount?: number) => void;
  /** Local user's real seat number, or null if spectating. */
  mySeat?: number | null;
}

const btnSx = {
  fontWeight: 700,
  textTransform: 'none' as const,
  borderRadius: 2,
  minWidth: { xs: 70, sm: 85 },
  fontSize: { xs: 12, sm: 13 },
  px: { xs: 1.5, sm: 2.5 },
  py: { xs: 0.75, sm: 1 },
};

function ActionButtons({ game, players, onAction, mySeat }: ActionButtonsProps) {
  if (!game || !players || !onAction) {
    return (
      <Box display="flex" gap={1} justifyContent="center" sx={{ opacity: 0.25 }}>
        <Button variant="contained" disabled size="small" sx={{ ...btnSx, bgcolor: '#546E7A' }}>Fold</Button>
        <Button variant="contained" disabled size="small" sx={{ ...btnSx, bgcolor: '#1565C0' }}>Call</Button>
        <Button variant="contained" disabled size="small" sx={{ ...btnSx, bgcolor: '#E65100' }}>Raise</Button>
        <Button variant="contained" disabled size="small" sx={{ ...btnSx, bgcolor: '#C62828', textTransform: 'uppercase' }}>All In</Button>
      </Box>
    );
  }

  const actingSeat = game.move;
  const actingPlayer = players.find((p) => p.seat === actingSeat && p.status === '1');
  const toCall = actingPlayer ? Math.max(0, game.currentBet - actingPlayer.bet) : 0;
  const callAmount = actingPlayer ? Math.min(toCall, actingPlayer.stack) : 0;
  // Only the local user gets to push action buttons — never on behalf of bots.
  const isMyTurn = !!actingPlayer && mySeat != null && Number(mySeat) === Number(actingPlayer.seat);
  const canAct = isMyTurn;
  const hasOutstandingBet = toCall > 0;
  const canCheck = !hasOutstandingBet;
  const canCall = hasOutstandingBet && !!actingPlayer && actingPlayer.stack > 0;
  const canBet = !hasOutstandingBet && !!actingPlayer && actingPlayer.stack > 0;
  const canRaise = hasOutstandingBet && !!actingPlayer && actingPlayer.stack > toCall;
  const canAllIn = !!actingPlayer && actingPlayer.stack > 0;
  const minBetAmount = Math.max(game.bigBlind, 1);
  const minRaiseAmount = Math.max(
    game.currentBet * 2,
    (game.lastRaiseSize || game.bigBlind) + game.currentBet
  );

  const handleAction = (action: string, amount?: number) => {
    if (!actingPlayer || !isMyTurn) return;
    onAction(actingPlayer.seat, action, amount);
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="center" gap={0.5}>
      {actingPlayer && (
        <Typography sx={{
          fontSize: { xs: 11, sm: 12 },
          color: isMyTurn ? '#FFD700' : '#8B8FA3',
          fontWeight: isMyTurn ? 700 : 500,
        }}>
          {isMyTurn
            ? `Your turn — ${toCall > 0 ? `$${callAmount.toFixed(2)} to call` : 'Check or Bet'}`
            : `Waiting for ${actingPlayer.username}…`}
        </Typography>
      )}
      <Box display="flex" gap={1} justifyContent="center" flexWrap="wrap">
        <Button variant="contained" onClick={() => handleAction('fold')} disabled={!canAct} size="small" sx={{ ...btnSx, bgcolor: '#546E7A', '&:hover': { bgcolor: '#455A64' } }}>Fold</Button>
        {canCheck && (
          <Button variant="contained" onClick={() => handleAction('check')} disabled={!canAct} size="small" sx={{ ...btnSx, bgcolor: '#2E7D32', '&:hover': { bgcolor: '#1B5E20' } }}>Check</Button>
        )}
        {canCall && (
          <Button variant="contained" onClick={() => handleAction('call')} disabled={!canAct} size="small" sx={{ ...btnSx, bgcolor: '#1565C0', '&:hover': { bgcolor: '#0D47A1' } }}>Call ${callAmount.toFixed(0)}</Button>
        )}
        {canBet && (
          <Button variant="contained" onClick={() => handleAction('bet', minBetAmount)} disabled={!canAct} size="small" sx={{ ...btnSx, bgcolor: '#E65100', '&:hover': { bgcolor: '#BF360C' } }}>Bet ${minBetAmount.toFixed(0)}</Button>
        )}
        {canRaise && (
          <Button variant="contained" onClick={() => handleAction('raise', minRaiseAmount)} disabled={!canAct} size="small" sx={{ ...btnSx, bgcolor: '#E65100', '&:hover': { bgcolor: '#BF360C' } }}>Raise ${minRaiseAmount.toFixed(0)}</Button>
        )}
        {canAllIn && (
          <Button variant="contained" onClick={() => handleAction('allin')} disabled={!canAct} size="small" sx={{ ...btnSx, bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'uppercase' }}>All In</Button>
        )}
      </Box>
    </Box>
  );
}

export default ActionButtons;
