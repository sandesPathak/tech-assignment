import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../api/client';
import { getTable, processStep, healthCheck } from '../api/poker.api';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTable', () => {
  it('fetches table state', async () => {
    const mockData = { game: { gameNo: 1 }, players: [] };
    mockGet.mockResolvedValue({ data: mockData });

    const result = await getTable(1);

    expect(mockGet).toHaveBeenCalledWith('/table/1');
    expect(result).toEqual(mockData);
  });
});

describe('processStep', () => {
  it('posts process request', async () => {
    const mockData = { success: true, result: { step: 1, stepName: 'SETUP_DEALER' } };
    mockPost.mockResolvedValue({ data: mockData });

    const result = await processStep(1);

    expect(mockPost).toHaveBeenCalledWith('/process', { tableId: 1 });
    expect(result.success).toBe(true);
  });
});

describe('healthCheck', () => {
  it('returns true on success', async () => {
    mockGet.mockResolvedValue({ data: {} });

    const result = await healthCheck();
    expect(result).toBe(true);
  });

  it('returns false on failure', async () => {
    mockGet.mockRejectedValue(new Error('fail'));

    const result = await healthCheck();
    expect(result).toBe(false);
  });
});
