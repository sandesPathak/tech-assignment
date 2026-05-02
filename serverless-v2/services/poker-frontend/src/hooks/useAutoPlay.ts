import { useState, useRef, useCallback } from 'react';

const SPEEDS = [1000, 500, 250, 2000];

export function useAutoPlay(advanceFn: () => Promise<unknown>) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const advanceRef = useRef(advanceFn);
  advanceRef.current = advanceFn;

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const start = useCallback(() => {
    stop();
    setIsPlaying(true);
    timerRef.current = setInterval(() => {
      advanceRef.current();
    }, SPEEDS[speedIndex]);
  }, [speedIndex, stop]);

  const toggle = useCallback(() => {
    if (isPlaying) {
      stop();
    } else {
      start();
    }
  }, [isPlaying, start, stop]);

  const cycleSpeed = useCallback(() => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (isPlaying) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        advanceRef.current();
      }, SPEEDS[next]);
    }
  }, [speedIndex, isPlaying]);

  const speed = SPEEDS[speedIndex];
  const speedLabel = `${speed / 1000}s`;

  return { isPlaying, speed, speedLabel, start, stop, toggle, cycleSpeed };
}
