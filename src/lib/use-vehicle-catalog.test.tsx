import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useVehicleCatalog } from './use-vehicle-catalog';
import type { CatalogEntry } from './vehicle-catalog';

const toyota = { id: 'toyota', lookup_key: 'toyota', display_name: 'Toyota' };
const honda = { id: 'honda', lookup_key: 'honda', display_name: 'Honda' };
const rav4 = { id: 'rav4', lookup_key: 'rav4', display_name: 'RAV4' };
const civic = { id: 'civic', lookup_key: 'civic', display_name: 'Civic' };
function deferred() {
  let resolve!: (value: CatalogEntry[]) => void;
  const promise = new Promise<CatalogEntry[]>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('modal catalog lifecycle', () => {
  it('makes zero reads when disabled and resolves only an exact normalized make', async () => {
    const reader = { makes: vi.fn(async () => [toyota, honda]), models: vi.fn(async () => [rav4]) };
    const hook = renderHook(({ enabled, make }) => useVehicleCatalog(enabled, make, reader), { initialProps: { enabled: false, make: 'Toyota' } });
    expect(reader.makes).not.toHaveBeenCalled(); expect(reader.models).not.toHaveBeenCalled();
    hook.rerender({ enabled: true, make: 'Toy' });
    await waitFor(() => expect(hook.result.current.makes.entries).toHaveLength(2));
    expect(reader.models).not.toHaveBeenCalled();
    hook.rerender({ enabled: true, make: ' TOYOTA  ' });
    await waitFor(() => expect(hook.result.current.models.entries).toEqual([rav4]));
    expect(reader.models).toHaveBeenCalledExactlyOnceWith('toyota');
    hook.rerender({ enabled: true, make: 'Toyota' });
    expect(reader.models).toHaveBeenCalledTimes(1);
    hook.rerender({ enabled: true, make: 'unknown' });
    expect(hook.result.current.models.entries).toEqual([]);
  });
  it('ignores out-of-order model responses, clears obsolete lists immediately, and ignores unmounted requests', async () => {
    const slow = deferred(), fast = deferred(), later = deferred();
    const reader = { makes: vi.fn(async () => [toyota, honda]), models: vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise).mockReturnValueOnce(later.promise) };
    const hook = renderHook(({ make }) => useVehicleCatalog(true, make, reader), { initialProps: { make: 'Toyota' } });
    await waitFor(() => expect(reader.models).toHaveBeenCalledWith('toyota'));
    hook.rerender({ make: 'Honda' });
    expect(hook.result.current.models.entries).toEqual([]);
    await act(async () => fast.resolve([civic]));
    await act(async () => slow.resolve([rav4]));
    expect(hook.result.current.models.entries).toEqual([civic]);
    hook.rerender({ make: 'Toyota' });
    expect(hook.result.current.models.entries).toEqual([]);
    hook.unmount();
    await act(async () => later.resolve([rav4]));
  });
  it('keeps failures separate and retries makes/models; empty catalogs stay usable', async () => {
    const reader = { makes: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([toyota]), models: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]) };
    const hook = renderHook(() => useVehicleCatalog(true, 'Toyota', reader));
    await waitFor(() => expect(hook.result.current.makes.failed).toBe(true));
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.models.failed).toBe(true));
    act(() => hook.result.current.retry());
    await waitFor(() => expect(reader.models).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.models.loading).toBe(false));
    expect(hook.result.current.models.failed).toBe(false);
    expect(hook.result.current.models.entries).toEqual([]);
  });
});
