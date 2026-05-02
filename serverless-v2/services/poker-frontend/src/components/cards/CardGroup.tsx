import { Box } from '@mui/material';
import Card from './Card';

interface CardGroupProps {
  cards: string[];
  faceDown?: boolean;
  totalSlots?: number;
  size?: 'small' | 'medium';
}

function CardGroup({ cards, faceDown, totalSlots, size = 'medium' }: CardGroupProps) {
  const slots = totalSlots ?? cards.length;

  return (
    <Box display="flex" gap={0.5}>
      {Array.from({ length: slots }, (_, i) => (
        <Card
          key={i}
          card={cards[i]}
          faceDown={faceDown && i < cards.length}
          size={size}
        />
      ))}
    </Box>
  );
}

export default CardGroup;
