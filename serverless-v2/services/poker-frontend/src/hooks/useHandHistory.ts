import { useState, useCallback } from 'react';

export interface LogEntry {
  id: number;
  message: string;
  type: 'step' | 'info' | 'winner' | 'error';
  timestamp: Date;
}

let nextId = 0;

export function useHandHistory() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const addEntry = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setEntries((prev) => {
      const next = [{ id: nextId++, message, type, timestamp: new Date() }, ...prev];
      return next.slice(0, 100);
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  return { entries, addEntry, clear };
}
