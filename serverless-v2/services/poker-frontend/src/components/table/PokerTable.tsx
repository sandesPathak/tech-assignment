import { Box, Typography } from '@mui/material';
import CardGroup from '../cards/CardGroup';
import PlayerSeat from '../player/PlayerSeat';
import type { TableState } from '../../types/poker.types';

interface PokerTableProps {
  tableState: TableState;
}

const SEAT_POSITIONS: Record<number, { top: string; left: string; transform: string }> = {
  1: { top: '5%', left: '27%', transform: 'translate(-50%, 0)' },
  2: { top: '5%', left: '73%', transform: 'translate(-50%, 0)' },
  3: { top: '42%', left: '97%', transform: 'translate(-50%, -50%)' },
  4: { top: '88%', left: '73%', transform: 'translate(-50%, -100%)' },
  5: { top: '88%', left: '27%', transform: 'translate(-50%, -100%)' },
  6: { top: '42%', left: '3%', transform: 'translate(-50%, -50%)' },
};

function PokerTable({ tableState }: PokerTableProps) {
  const { game, players } = tableState;
  const hasCards = game.communityCards && game.communityCards.length > 0;

  return (
    <Box
      data-testid="poker-table"
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: 860,
        height: 520,
        mx: 'auto',
      }}
    >
      {/* Table felt */}
      <Box
        sx={{
          position: 'absolute',
          top: '14%',
          left: '12%',
          width: '76%',
          height: '72%',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at 40% 40%, #2d7a4a, #1b5c35, #134528)',
          border: '10px solid #3d2a1a',
          boxShadow: '0 0 60px rgba(0,0,0,0.6), inset 0 0 40px rgba(0,0,0,0.3), 0 0 0 14px #2a1a0a',
        }}
      >
        {/* Community cards */}
        <Box
          sx={{
            position: 'absolute',
            top: '38%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            gap: 0.75,
          }}
        >
          {hasCards ? (
            <CardGroup cards={game.communityCards} totalSlots={5} />
          ) : (
            <CardGroup cards={[]} totalSlots={5} />
          )}
        </Box>

        {/* Pot */}
        <Box
          data-testid="pot-display"
          sx={{
            position: 'absolute',
            top: '60%',
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: 'rgba(0,0,0,0.55)',
            borderRadius: 2,
            px: 2,
            py: 0.5,
          }}
        >
          <Typography sx={{ color: '#FFD700', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>
            {game.pot > 0 ? `POT: $${game.pot.toFixed(2)}` : `Blinds: $${game.smallBlind}/$${game.bigBlind}`}
          </Typography>
        </Box>
      </Box>

      {/* Player seats */}
      {players.map((player) => {
        const pos = SEAT_POSITIONS[player.seat];
        if (!pos) return null;
        return (
          <Box
            key={player.seat}
            sx={{
              position: 'absolute',
              top: pos.top,
              left: pos.left,
              transform: pos.transform,
              zIndex: 2,
            }}
          >
            <PlayerSeat player={player} game={game} />
          </Box>
        );
      })}
    </Box>
  );
}

export default PokerTable;
