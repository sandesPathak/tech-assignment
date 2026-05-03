import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Stack,
  Tabs,
  Tab,
  Chip,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

interface Props {
  open: boolean
  onClose: () => void
}

// ── theme tokens (match PokerLobby palette) ─────────────────────────────
const C = {
  bg: '#0F1117',
  surface: '#1A1D27',
  surfaceLow: '#141720',
  border: '#2A2D3A',
  borderHi: 'rgba(255,107,53,0.5)',
  text: '#FFFFFF',
  textDim: '#8B8FA3',
  orange: '#FF6B35',
  orangeSoft: 'rgba(255,107,53,0.15)',
  green: '#4ADE80',
  red: '#EF5350',
  blue: '#60A5FA',
  yellow: '#FBBF24',
}

// ── tiny visual playing card ────────────────────────────────────────────
type Suit = '♠' | '♥' | '♦' | '♣'
const isRed = (s: Suit) => s === '♥' || s === '♦'

function MiniCard({ rank, suit, size = 'md' }: { rank: string; suit: Suit; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 30 : 38
  const h = size === 'sm' ? 42 : 54
  const big = size === 'sm' ? 14 : 18
  return (
    <Box
      sx={{
        width: w,
        height: h,
        bgcolor: '#fff',
        borderRadius: '6px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        px: 0.5,
        py: 0.4,
        color: isRed(suit) ? '#D0021B' : '#111',
        fontWeight: 800,
        fontSize: big,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      <Box>{rank}</Box>
      <Box sx={{ alignSelf: 'flex-end', fontSize: big + 2 }}>{suit}</Box>
    </Box>
  )
}

function CardRow({ cards }: { cards: { rank: string; suit: Suit }[] }) {
  return (
    <Stack direction="row" spacing={0.5}>
      {cards.map((c, i) => (
        <MiniCard key={i} rank={c.rank} suit={c.suit} size="sm" />
      ))}
    </Stack>
  )
}

// ── hand-ranking dataset (10 standard hands, strongest → weakest) ───────
interface Rank {
  name: string
  blurb: string
  cards: { rank: string; suit: Suit }[]
  oddsLine: string
}

const RANKS: Rank[] = [
  {
    name: 'Royal Flush',
    blurb: 'A, K, Q, J, 10 — all the same suit. The unbeatable hand.',
    cards: [
      { rank: 'A', suit: '♠' },
      { rank: 'K', suit: '♠' },
      { rank: 'Q', suit: '♠' },
      { rank: 'J', suit: '♠' },
      { rank: '10', suit: '♠' },
    ],
    oddsLine: '~1 in 650,000 hands',
  },
  {
    name: 'Straight Flush',
    blurb: 'Five consecutive cards of the same suit (A counts as 1 or high).',
    cards: [
      { rank: '9', suit: '♥' },
      { rank: '8', suit: '♥' },
      { rank: '7', suit: '♥' },
      { rank: '6', suit: '♥' },
      { rank: '5', suit: '♥' },
    ],
    oddsLine: '~1 in 72,000',
  },
  {
    name: 'Four of a Kind',
    blurb: 'Four cards of the same rank, plus any 5th card (the kicker).',
    cards: [
      { rank: 'Q', suit: '♠' },
      { rank: 'Q', suit: '♥' },
      { rank: 'Q', suit: '♦' },
      { rank: 'Q', suit: '♣' },
      { rank: '5', suit: '♣' },
    ],
    oddsLine: '~1 in 4,165',
  },
  {
    name: 'Full House',
    blurb: 'Three of a kind plus a pair. "Aces full of fives" = three A + two 5.',
    cards: [
      { rank: 'A', suit: '♠' },
      { rank: 'A', suit: '♥' },
      { rank: 'A', suit: '♦' },
      { rank: '5', suit: '♣' },
      { rank: '5', suit: '♦' },
    ],
    oddsLine: '~1 in 694',
  },
  {
    name: 'Flush',
    blurb: 'Five cards of the same suit, any ranks. Higher top card wins ties.',
    cards: [
      { rank: 'K', suit: '♣' },
      { rank: 'J', suit: '♣' },
      { rank: '8', suit: '♣' },
      { rank: '5', suit: '♣' },
      { rank: '2', suit: '♣' },
    ],
    oddsLine: '~1 in 509',
  },
  {
    name: 'Straight',
    blurb: 'Five consecutive cards, any suits. A-2-3-4-5 is the lowest ("wheel").',
    cards: [
      { rank: '10', suit: '♠' },
      { rank: '9', suit: '♥' },
      { rank: '8', suit: '♦' },
      { rank: '7', suit: '♣' },
      { rank: '6', suit: '♥' },
    ],
    oddsLine: '~1 in 255',
  },
  {
    name: 'Three of a Kind',
    blurb: 'Three cards of the same rank plus two unrelated cards.',
    cards: [
      { rank: '7', suit: '♠' },
      { rank: '7', suit: '♥' },
      { rank: '7', suit: '♦' },
      { rank: 'K', suit: '♣' },
      { rank: '4', suit: '♥' },
    ],
    oddsLine: '~1 in 47',
  },
  {
    name: 'Two Pair',
    blurb: 'Two cards of one rank, two of another, plus a kicker.',
    cards: [
      { rank: 'J', suit: '♠' },
      { rank: 'J', suit: '♦' },
      { rank: '4', suit: '♣' },
      { rank: '4', suit: '♥' },
      { rank: 'A', suit: '♠' },
    ],
    oddsLine: '~1 in 21',
  },
  {
    name: 'One Pair',
    blurb: 'A single pair of matching cards. Higher pair wins; kicker breaks ties.',
    cards: [
      { rank: '10', suit: '♠' },
      { rank: '10', suit: '♥' },
      { rank: 'K', suit: '♦' },
      { rank: '6', suit: '♣' },
      { rank: '3', suit: '♣' },
    ],
    oddsLine: '~1 in 2.4',
  },
  {
    name: 'High Card',
    blurb: 'Nothing matches. The highest card plays — Ace high beats King high.',
    cards: [
      { rank: 'A', suit: '♣' },
      { rank: 'J', suit: '♥' },
      { rank: '8', suit: '♠' },
      { rank: '5', suit: '♦' },
      { rank: '2', suit: '♣' },
    ],
    oddsLine: '~1 in 2 (most common)',
  },
]

// ── action chips ────────────────────────────────────────────────────────
const ACTIONS: { name: string; color: string; desc: string }[] = [
  { name: 'Fold', color: C.red, desc: 'Throw your cards away. You forfeit any chips already in the pot — but lose nothing more.' },
  { name: 'Check', color: C.textDim, desc: 'Pass the action without betting. Only legal when no one has bet yet this round.' },
  { name: 'Call', color: C.blue, desc: 'Match the current bet to stay in the hand.' },
  { name: 'Bet', color: C.green, desc: 'Be the first to put chips in this round.' },
  { name: 'Raise', color: C.orange, desc: 'Increase the current bet. Others must call the new amount, raise again, or fold.' },
  { name: 'All-in', color: C.yellow, desc: 'Push every chip you have. If your stack is short, you can still win up to a side pot.' },
]

// ── tabs ────────────────────────────────────────────────────────────────
function HowToPlayDialog({ open, onClose }: Props) {
  const [tab, setTab] = useState(0)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: C.surface,
          color: C.text,
          border: `1px solid ${C.border}`,
          borderRadius: 3,
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${C.border}`,
          pb: 1,
        }}
      >
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>
            How to play Texas Hold&rsquo;em
          </Typography>
          <Typography sx={{ fontSize: 12, color: C.textDim }}>
            Two hole cards. Five community cards. Best 5-card hand wins.
          </Typography>
        </Box>
        <IconButton onClick={onClose} sx={{ color: C.textDim }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: `1px solid ${C.border}`,
          bgcolor: C.surfaceLow,
          '& .MuiTab-root': {
            color: C.textDim,
            textTransform: 'none',
            fontWeight: 600,
            minHeight: 44,
          },
          '& .Mui-selected': { color: `${C.orange} !important` },
          '& .MuiTabs-indicator': { bgcolor: C.orange },
        }}
      >
        <Tab label="The basics" />
        <Tab label="Hand rankings" />
        <Tab label="Betting rounds" />
        <Tab label="Your actions" />
        <Tab label="Pro tips" />
      </Tabs>

      <DialogContent sx={{ p: 3, bgcolor: C.surface }}>
        {tab === 0 && <BasicsTab />}
        {tab === 1 && <RankingsTab />}
        {tab === 2 && <RoundsTab />}
        {tab === 3 && <ActionsTab />}
        {tab === 4 && <TipsTab />}
      </DialogContent>
    </Dialog>
  )
}

// ── tab: basics ─────────────────────────────────────────────────────────
function BasicsTab() {
  return (
    <Stack spacing={2.5}>
      <Section title="The goal">
        <Typography sx={{ color: C.textDim, fontSize: 14, lineHeight: 1.65 }}>
          Make the strongest possible 5-card poker hand using any combination of your
          two private cards (your <b style={{ color: C.text }}>hole cards</b>) and
          the five shared <b style={{ color: C.text }}>community cards</b> in the
          middle of the table. You can use both, one, or neither of your hole cards
          — the best 5 of 7 wins.
        </Typography>
      </Section>

      <Section title="Seats, dealer button & blinds">
        <Typography sx={{ color: C.textDim, fontSize: 14, lineHeight: 1.65 }}>
          Each hand a <b style={{ color: C.text }}>dealer button</b> rotates one
          seat clockwise. The two players to the left of the button post forced
          bets:
        </Typography>
        <Stack direction="row" spacing={2} mt={1.5} flexWrap="wrap">
          <Stat label="Small Blind" value="½ of the big bet" tint={C.blue} />
          <Stat label="Big Blind" value="The minimum bet" tint={C.orange} />
          <Stat label="Dealer (D)" value="Acts last after the flop" tint={C.green} />
        </Stack>
        <Typography sx={{ color: C.textDim, fontSize: 13, mt: 1.5, lineHeight: 1.6 }}>
          On a $1/$2 table the small blind is $1 and the big blind is $2. Blinds
          ensure there are always chips to fight for.
        </Typography>
      </Section>

      <Section title="A hand at a glance">
        <Stack spacing={1}>
          {[
            ['1.', 'Blinds posted, hole cards dealt to every seated player.'],
            ['2.', 'Pre-flop betting begins — the player left of the big blind acts first.'],
            ['3.', 'Flop: three community cards revealed. Another betting round.'],
            ['4.', 'Turn: a fourth community card. Another round.'],
            ['5.', 'River: the fifth and final community card. Final round of betting.'],
            ['6.', 'Showdown: anyone still in flips their cards. Best 5-card hand wins the pot.'],
          ].map(([n, t]) => (
            <Stack key={n} direction="row" spacing={1.5} alignItems="flex-start">
              <Typography sx={{ color: C.orange, fontWeight: 800, fontSize: 13, minWidth: 20 }}>{n}</Typography>
              <Typography sx={{ color: C.textDim, fontSize: 14 }}>{t}</Typography>
            </Stack>
          ))}
        </Stack>
      </Section>
    </Stack>
  )
}

// ── tab: rankings ───────────────────────────────────────────────────────
function RankingsTab() {
  return (
    <Stack spacing={1.5}>
      <Typography sx={{ color: C.textDim, fontSize: 13, lineHeight: 1.6 }}>
        Strongest at the top, weakest at the bottom. When two players make the
        same hand, the one with higher cards in the hand wins; if those tie, the
        next-highest unrelated card (the <b style={{ color: C.text }}>kicker</b>)
        breaks the tie.
      </Typography>
      {RANKS.map((r, i) => (
        <Stack
          key={r.name}
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ sm: 'center' }}
          sx={{
            p: 1.5,
            borderRadius: 2,
            bgcolor: i % 2 === 0 ? C.surfaceLow : 'transparent',
            border: `1px solid ${i === 0 ? C.borderHi : C.border}`,
          }}
        >
          <Box sx={{ minWidth: 40 }}>
            <Typography sx={{ fontWeight: 900, color: i === 0 ? C.orange : C.textDim, fontSize: 14 }}>
              #{i + 1}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 165 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{r.name}</Typography>
            <Typography sx={{ fontSize: 11, color: C.textDim, mt: 0.25 }}>{r.oddsLine}</Typography>
          </Box>
          <Box sx={{ flexShrink: 0 }}>
            <CardRow cards={r.cards} />
          </Box>
          <Typography sx={{ color: C.textDim, fontSize: 13, lineHeight: 1.55, flex: 1 }}>
            {r.blurb}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}

// ── tab: rounds ─────────────────────────────────────────────────────────
function RoundsTab() {
  const rounds = [
    {
      title: 'Pre-flop',
      cards: 0,
      desc: 'You see only your two hole cards. Action starts left of the big blind. You can fold, call the big blind, or raise.',
    },
    {
      title: 'The flop',
      cards: 3,
      desc: 'Three community cards face-up in the middle. Action starts left of the dealer. You can check, bet, raise, or fold.',
    },
    {
      title: 'The turn',
      cards: 4,
      desc: 'A fourth community card is added. Another full round of betting follows.',
    },
    {
      title: 'The river',
      cards: 5,
      desc: 'The fifth and final card. Last round of betting — your last chance to put chips in or get out.',
    },
    {
      title: 'Showdown',
      cards: 5,
      desc: 'If two or more players are still in, hands are revealed. The best 5-card combination wins. If everyone else folded earlier, the last player standing simply takes the pot.',
    },
  ]
  return (
    <Stack spacing={2}>
      {rounds.map((r, i) => (
        <Box
          key={r.title}
          sx={{
            p: 2,
            borderRadius: 2,
            bgcolor: C.surfaceLow,
            border: `1px solid ${i === 0 ? C.borderHi : C.border}`,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { sm: 'center' },
            gap: 2,
          }}
        >
          <Box sx={{ minWidth: 90 }}>
            <Typography sx={{ fontSize: 11, color: C.orange, letterSpacing: 1.5, fontWeight: 700 }}>
              ROUND {i + 1}
            </Typography>
            <Typography sx={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>{r.title}</Typography>
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ minHeight: 54 }}>
            {Array.from({ length: 5 }).map((_, idx) => {
              const visible = idx < r.cards
              return visible ? (
                <MiniCard key={idx} rank={['A', 'K', 'Q', 'J', '10'][idx]} suit={(['♠', '♥', '♦', '♣', '♠'] as Suit[])[idx]} size="sm" />
              ) : (
                <Box
                  key={idx}
                  sx={{
                    width: 30,
                    height: 42,
                    borderRadius: '6px',
                    border: `1px dashed ${C.border}`,
                    bgcolor: 'transparent',
                  }}
                />
              )
            })}
          </Stack>
          <Typography sx={{ color: C.textDim, fontSize: 13.5, lineHeight: 1.55, flex: 1 }}>
            {r.desc}
          </Typography>
        </Box>
      ))}
    </Stack>
  )
}

// ── tab: actions ────────────────────────────────────────────────────────
function ActionsTab() {
  return (
    <Stack spacing={2}>
      <Typography sx={{ color: C.textDim, fontSize: 13.5, lineHeight: 1.6 }}>
        On every betting round you face one of these decisions when the action
        gets to you. Buttons appear on screen when it&apos;s your turn — you have
        a turn timer, so think fast but think well.
      </Typography>
      {ACTIONS.map((a) => (
        <Stack
          key={a.name}
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{
            p: 1.5,
            borderRadius: 2,
            bgcolor: C.surfaceLow,
            border: `1px solid ${C.border}`,
          }}
        >
          <Chip
            label={a.name.toUpperCase()}
            sx={{
              minWidth: 96,
              fontWeight: 800,
              letterSpacing: 1,
              bgcolor: 'transparent',
              color: a.color,
              border: `1px solid ${a.color}`,
            }}
          />
          <Typography sx={{ color: C.textDim, fontSize: 14, lineHeight: 1.55 }}>
            {a.desc}
          </Typography>
        </Stack>
      ))}
      <Box
        sx={{
          mt: 1,
          p: 1.5,
          borderRadius: 2,
          border: `1px solid ${C.borderHi}`,
          bgcolor: C.orangeSoft,
        }}
      >
        <Typography sx={{ color: C.orange, fontWeight: 700, fontSize: 13, mb: 0.5 }}>
          Minimum raise rule
        </Typography>
        <Typography sx={{ color: C.textDim, fontSize: 13, lineHeight: 1.55 }}>
          A raise must be at least as large as the previous raise this round. So
          if the bet is $20 and someone raised to $40 (a $20 raise), the next
          raise must be at least $60.
        </Typography>
      </Box>
    </Stack>
  )
}

// ── tab: tips ───────────────────────────────────────────────────────────
function TipsTab() {
  const tips: { title: string; body: string }[] = [
    {
      title: 'Position is power',
      body: 'Acting later in a round means you see what others do first. Late position (the dealer button and seats next to it) is the most profitable place at the table.',
    },
    {
      title: 'Play tight, then aggressive',
      body: 'Fold most of your weak starting hands without paying anything. When you do enter a pot, lead with bets and raises rather than calling — pressure wins pots.',
    },
    {
      title: 'Learn pot odds',
      body: 'If the pot is $100 and a call costs you $20, you need to win the hand more than 1 in 6 times for the call to break even. The math beats hunches over time.',
    },
    {
      title: 'Bluff with a story',
      body: 'A good bluff makes sense given the cards on the board and how you\'ve been playing. Random bluffs against multiple players almost never work.',
    },
    {
      title: 'Manage your stack',
      body: 'Don\'t risk your tournament life on a marginal hand early. Conversely, when you\'re short-stacked, look for a spot to push all-in before the blinds eat you.',
    },
    {
      title: 'Watch, don\'t chat',
      body: 'When you\'re not in a hand, watch how opponents bet. Patterns reveal more than their cards ever will.',
    },
  ]
  return (
    <Stack spacing={1.5}>
      {tips.map((t, i) => (
        <Box
          key={t.title}
          sx={{
            p: 1.75,
            borderRadius: 2,
            bgcolor: C.surfaceLow,
            border: `1px solid ${C.border}`,
          }}
        >
          <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: 14, mb: 0.5 }}>
            {i + 1}. {t.title}
          </Typography>
          <Typography sx={{ color: C.textDim, fontSize: 13.5, lineHeight: 1.6 }}>
            {t.body}
          </Typography>
        </Box>
      ))}
      <Box
        sx={{
          p: 1.75,
          borderRadius: 2,
          border: `1px solid ${C.borderHi}`,
          bgcolor: C.orangeSoft,
        }}
      >
        <Typography sx={{ fontSize: 13, color: C.orange, fontWeight: 700, mb: 0.5 }}>
          Play responsibly
        </Typography>
        <Typography sx={{ color: C.textDim, fontSize: 13, lineHeight: 1.6 }}>
          Set a session budget before you sit down, and walk away when you hit
          it. The cards don&rsquo;t care whether you&rsquo;re tilted.
        </Typography>
      </Box>
    </Stack>
  )
}

// ── small helpers ───────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography
        sx={{
          fontSize: 11,
          color: C.orange,
          fontWeight: 800,
          letterSpacing: 2,
          mb: 1,
        }}
      >
        {title.toUpperCase()}
      </Typography>
      {children}
    </Box>
  )
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 140,
        p: 1.5,
        borderRadius: 2,
        bgcolor: C.surfaceLow,
        border: `1px solid ${C.border}`,
      }}
    >
      <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: tint }}>
        {label.toUpperCase()}
      </Typography>
      <Typography sx={{ fontSize: 14, color: '#fff', fontWeight: 600, mt: 0.25 }}>
        {value}
      </Typography>
    </Box>
  )
}

export default HowToPlayDialog
