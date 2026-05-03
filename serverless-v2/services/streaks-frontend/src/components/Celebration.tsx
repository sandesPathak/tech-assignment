import { useEffect, useRef, useCallback } from 'react';
import { Box } from '@mui/system';
import gsap from 'gsap';

const EMOJIS = ['🔥', '⭐', '🎯', '💎', '🏆', '✨', '🎉', '💪', '🚀', '💰'];
const CONFETTI_COLORS = ['#FF6B35', '#FFD700', '#4ADE80', '#60A5FA', '#E040FB', '#FF5252', '#00E5FF', '#FFAB00'];

interface CelebrationProps {
  active: boolean;
  onComplete?: () => void;
  label?: string;
}

function Celebration({ active, onComplete, label = 'STREAK!' }: CelebrationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const stableOnComplete = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    container.innerHTML = '';

    // Create confetti pieces
    const confetti: HTMLDivElement[] = [];
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      const isEmoji = i < 12;
      if (isEmoji) {
        el.textContent = EMOJIS[i % EMOJIS.length];
        el.style.fontSize = `${20 + Math.random() * 16}px`;
      } else {
        el.style.width = `${6 + Math.random() * 8}px`;
        el.style.height = `${6 + Math.random() * 8}px`;
        el.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      }
      el.style.position = 'absolute';
      el.style.left = '50%';
      el.style.top = '50%';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      container.appendChild(el);
      confetti.push(el);
    }

    // Create center burst text
    const burstText = document.createElement('div');
    burstText.textContent = label;
    burstText.style.cssText = `
      position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%) scale(0);
      font-size: 48px; font-weight: 900; color: #FFD700;
      text-shadow: 0 0 20px rgba(255,215,0,0.5), 0 0 40px rgba(255,107,53,0.3);
      pointer-events: none; white-space: nowrap; letter-spacing: 4px;
    `;
    container.appendChild(burstText);

    // Create shockwave ring
    const ring = document.createElement('div');
    ring.style.cssText = `
      position: absolute; left: 50%; top: 45%; width: 0; height: 0;
      border: 3px solid rgba(255,215,0,0.6); border-radius: 50%;
      transform: translate(-50%, -50%); pointer-events: none;
    `;
    container.appendChild(ring);

    const tl = gsap.timeline({
      onComplete: () => {
        container.innerHTML = '';
        stableOnComplete();
      },
    });
    tlRef.current = tl;

    // Phase 1: Shockwave ring expands
    tl.to(ring, {
      width: 300,
      height: 300,
      opacity: 0,
      duration: 0.6,
      ease: 'power2.out',
    }, 0);

    // Phase 2: Center text punches in
    tl.fromTo(burstText,
      { scale: 0, rotation: -10 },
      { scale: 1, rotation: 0, duration: 0.5, ease: 'back.out(2.5)' },
      0.1
    );
    tl.to(burstText, {
      scale: 1.3,
      opacity: 0,
      duration: 0.6,
      ease: 'power2.in',
    }, 0.9);

    // Phase 3: Confetti explosion — physics-style arcs
    confetti.forEach((el, i) => {
      const angle = (i / confetti.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const velocity = 150 + Math.random() * 250;
      const xDist = Math.cos(angle) * velocity;
      const yDist = Math.sin(angle) * velocity - 100; // bias upward

      tl.to(el, {
        opacity: 1,
        duration: 0.05,
      }, 0.05 + Math.random() * 0.15);

      tl.to(el, {
        x: xDist,
        y: yDist,
        rotation: (Math.random() - 0.5) * 720,
        duration: 1.2 + Math.random() * 0.6,
        ease: 'power2.out',
      }, 0.05 + Math.random() * 0.15);

      // Gravity — pull down after peak
      tl.to(el, {
        y: `+=${200 + Math.random() * 300}`,
        opacity: 0,
        duration: 0.8 + Math.random() * 0.4,
        ease: 'power1.in',
      }, 0.8 + Math.random() * 0.3);
    });

    return () => {
      tl.kill();
      container.innerHTML = '';
    };
  }, [active, stableOnComplete, label]);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        overflow: 'hidden',
      }}
    />
  );
}

export default Celebration;
