import { useState, useCallback, useEffect } from 'react';
import { getTable, processStep } from '../api/poker.api';
import type { TableState } from '../types/poker.types';

export function useGameState(tableId: number) {
  const [tableState, setTableState] = useState<TableState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const state = await getTable(tableId);
      setTableState(state);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch table');
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  const advance = useCallback(async (action?: { seat: number; action: string; amount?: number }) => {
    try {
      setError(null);
      const result = await processStep(tableId, action);
      // If awaiting action, just refresh to show current state
      if (result.result && 'error' in result.result) {
        const state = await getTable(tableId);
        setTableState(state);
        return state;
      }
      const state = await getTable(tableId);
      setTableState(state);
      return state;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to process step');
      return null;
    }
  }, [tableId]);

  const sendAction = useCallback(async (seat: number, action: string, amount?: number) => {
    try {
      setError(null);
      await processStep(tableId, { seat, action, amount });
      const state = await getTable(tableId);
      setTableState(state);
      return state;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send action');
      return null;
    }
  }, [tableId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tableState, loading, error, refresh, advance, sendAction };
}
