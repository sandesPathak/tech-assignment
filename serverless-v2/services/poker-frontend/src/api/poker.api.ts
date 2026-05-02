import apiClient from './client';
import type { TableState, ProcessResult } from '../types/poker.types';

export async function getTable(tableId: number): Promise<TableState> {
  const { data } = await apiClient.get<TableState>(`/table/${tableId}`);
  return data;
}

export async function processStep(
  tableId: number,
  action?: { seat: number; action: string; amount?: number }
): Promise<ProcessResult> {
  const body: Record<string, unknown> = { tableId };
  if (action) {
    body.seat = action.seat;
    body.action = action.action;
    if (action.amount !== undefined) body.amount = action.amount;
  }
  const { data } = await apiClient.post<ProcessResult>('/process', body);
  return data;
}

export async function healthCheck(): Promise<boolean> {
  try {
    await apiClient.get('/health');
    return true;
  } catch {
    return false;
  }
}
