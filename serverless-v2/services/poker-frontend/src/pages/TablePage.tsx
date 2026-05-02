import { useEffect, useRef } from 'react';
import { Box, Typography, CircularProgress, Alert } from '@mui/material';
import PokerTable from '../components/table/PokerTable';
import GameControls from '../components/controls/GameControls';
import ActionButtons from '../components/controls/ActionButtons';
import PhaseIndicator from '../components/info/PhaseIndicator';
import HandHistoryLog from '../components/info/HandHistoryLog';
import { useGameState } from '../hooks/useGameState';
import { useAutoPlay } from '../hooks/useAutoPlay';
import { useHandHistory } from '../hooks/useHandHistory';
import { PHASE_LABELS } from '../types/poker.types';

const TABLE_ID = 1;

function TablePage() {
  const { tableState, loading, error, refresh, advance, sendAction } = useGameState(TABLE_ID);
  const { entries, addEntry } = useHandHistory();
  const prevStepRef = useRef<string | null>(null);

  const handleAdvance = async () => {
    const result = await advance();
    if (result) {
      const label = PHASE_LABELS[result.game.stepName] || result.game.stepName;
      addEntry(`Hand #${result.game.gameNo} — ${label}`, 'step');

      if (result.game.stepName === 'PAY_WINNERS') {
        result.players.forEach((p) => {
          if (p.winnings > 0) {
            addEntry(`${p.username} wins $${p.winnings.toFixed(2)}${p.handRank ? ` (${p.handRank})` : ''}`, 'winner');
          }
        });
      }
    }
  };

  const handleAction = async (seat: number, action: string, amount?: number) => {
    const result = await sendAction(seat, action, amount);
    if (result) {
      const player = result.players.find((p) => p.seat === seat);
      const name = player?.username || `Seat ${seat}`;
      const amountStr = amount ? ` $${amount}` : '';
      addEntry(`${name}: ${action.toUpperCase()}${amountStr}`, 'step');

      // Auto-advance after action if betting round might be complete
      // Keep advancing non-betting steps automatically
      const autoAdvanceSteps = ['DEAL_FLOP', 'DEAL_TURN', 'DEAL_RIVER', 'AFTER_RIVER_BETTING_ROUND', 'FIND_WINNERS', 'PAY_WINNERS', 'RECORD_STATS_AND_NEW_HAND'];
      if (autoAdvanceSteps.includes(result.game.stepName)) {
        const label = PHASE_LABELS[result.game.stepName] || result.game.stepName;
        addEntry(`Hand #${result.game.gameNo} — ${label}`, 'step');
      }
    }
  };

  const { isPlaying, speedLabel, toggle, cycleSpeed, stop } = useAutoPlay(handleAdvance);

  // Detect hand transitions
  useEffect(() => {
    if (!tableState) return;
    const currentStep = tableState.game.stepName;
    if (prevStepRef.current === 'RECORD_STATS_AND_NEW_HAND' && currentStep === 'GAME_PREP') {
      addEntry('--- New Hand ---', 'info');
    }
    prevStepRef.current = currentStep;
  }, [tableState, addEntry]);

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh" bgcolor="#0a0e14">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="100vh" bgcolor="#0a0e14" gap={2} p={4}>
        <Alert severity="error" sx={{ maxWidth: 500 }}>{error}</Alert>
        <Typography color="text.secondary" fontSize={13}>
          Make sure the engine profile is running: docker compose --profile engine up
        </Typography>
      </Box>
    );
  }

  if (!tableState) return null;

  const isBettingStep = tableState.game.stepName.includes('BETTING');

  return (
    <Box
      sx={{
        height: '100vh',
        bgcolor: '#0a0e14',
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      {/* Main area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'center', bgcolor: '#0d1219', borderBottom: '1px solid #1e2a3a' }}>
          <PhaseIndicator
            handStep={tableState.game.handStep}
            stepName={tableState.game.stepName}
            gameNo={tableState.game.gameNo}
          />
        </Box>

        {/* Table */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
          <PokerTable tableState={tableState} />
        </Box>

        {/* Action buttons (for betting rounds) */}
        <Box sx={{ px: 2, pb: 1 }}>
          <ActionButtons
            game={isBettingStep ? tableState.game : undefined}
            players={isBettingStep ? tableState.players : undefined}
            onAction={isBettingStep ? handleAction : undefined}
          />
        </Box>

        {/* Game controls */}
        <Box sx={{ bgcolor: '#0d1219', borderTop: '1px solid #1e2a3a', p: 1.5 }}>
          <GameControls
            onNextStep={handleAdvance}
            onToggleAuto={toggle}
            onCycleSpeed={cycleSpeed}
            onReset={() => { stop(); refresh(); }}
            isPlaying={isPlaying}
            speedLabel={speedLabel}
          />
        </Box>
      </Box>

      {/* Hand history sidebar */}
      <Box
        sx={{
          width: 250,
          flexShrink: 0,
          bgcolor: '#0d1117',
          borderLeft: '1px solid #1e2a3a',
          p: 1.5,
          overflowY: 'auto',
        }}
      >
        <HandHistoryLog entries={entries} />
      </Box>
    </Box>
  );
}

export default TablePage;
