import { describe, expect, it, vi } from 'vitest';
import { setupWorkerStatusPolling } from './worker-status.js';

const response = (data) => ({
  ok: true,
  json: () => Promise.resolve(data),
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('setupWorkerStatusPolling', () => {
  it('updates status, labels, context usage, and model selector state', async () => {
    let knownModelLabel = '';
    let knownThinkingLevel = '';
    const setStatus = vi.fn();
    const setModelLabel = vi.fn();
    const setThinkingLabel = vi.fn();
    const updateContextUsage = vi.fn();
    const onWorkerModelUpdate = vi.fn();

    setupWorkerStatusPolling({
      windowImpl: new EventTarget(),
      sessionId: 's',
      chatApi: {
        getWorkerStatus: vi.fn(() =>
          Promise.resolve(
            response({
              state: 'running',
              model: 'gpt-4o',
              modelProvider: 'openai',
              thinkingLevel: 'high',
            }),
          ),
        ),
      },
      setStatus,
      setModelLabel,
      setThinkingLabel,
      updateContextUsage,
      getKnownModelLabel: () => knownModelLabel,
      setKnownModelLabel: (label) => {
        knownModelLabel = label;
      },
      getKnownThinkingLevel: () => knownThinkingLevel,
      setKnownThinkingLevel: (level) => {
        knownThinkingLevel = level;
      },
      getWorkerModelUpdate: () => onWorkerModelUpdate,
      setIntervalImpl: () => {},
      CustomEventImpl: Event,
    });
    await tick();

    expect(setStatus).toHaveBeenCalledWith('running', 'running');
    expect(setModelLabel).toHaveBeenCalledWith('gpt-4o @ openai');
    expect(setThinkingLabel).toHaveBeenCalledWith('high');
    expect(updateContextUsage).toHaveBeenCalled();
    expect(onWorkerModelUpdate).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('forwards extension status lines and clears them when absent', async () => {
    const setExtensionStatuses = vi.fn();
    const getWorkerStatus = vi
      .fn()
      .mockResolvedValueOnce(
        response({ state: 'idle', extensionStatuses: { quota: 'Codex 5h 73% left' } }),
      )
      .mockResolvedValueOnce(response({ state: 'idle' }));
    const controller = setupWorkerStatusPolling({
      windowImpl: new EventTarget(),
      sessionId: 's',
      chatApi: { getWorkerStatus },
      setExtensionStatuses,
      setIntervalImpl: () => {},
      CustomEventImpl: Event,
    });
    await tick();
    expect(setExtensionStatuses).toHaveBeenLastCalledWith({ quota: 'Codex 5h 73% left' });

    await controller.refresh();
    expect(setExtensionStatuses).toHaveBeenLastCalledWith({});
  });

  it('dispatches pi-worker-done on running to idle transition', async () => {
    const events = [];
    const windowImpl = new EventTarget();
    windowImpl.addEventListener('pi-worker-done', (event) => events.push(event.type));
    const getWorkerStatus = vi
      .fn()
      .mockResolvedValueOnce(response({ state: 'running' }))
      .mockResolvedValueOnce(response({ state: 'idle' }));

    const controller = setupWorkerStatusPolling({
      windowImpl,
      chatApi: { getWorkerStatus },
      setIntervalImpl: () => {},
      CustomEventImpl: Event,
    });
    await tick();
    await controller.refresh();

    expect(events).toEqual(['pi-worker-done']);
  });

  it('refreshes immediately on session reload', async () => {
    const windowImpl = new EventTarget();
    const getWorkerStatus = vi.fn(() => Promise.resolve(response({ state: 'idle' })));

    setupWorkerStatusPolling({
      windowImpl,
      chatApi: { getWorkerStatus },
      setIntervalImpl: () => {},
      CustomEventImpl: Event,
    });
    await tick();
    const initialCalls = getWorkerStatus.mock.calls.length;

    windowImpl.dispatchEvent(new Event('pi-session-reload'));
    await tick();

    expect(getWorkerStatus.mock.calls.length).toBe(initialCalls + 1);
  });

  it('coalesces refreshes while a request is in flight', async () => {
    let resolveFirst;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const getWorkerStatus = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(response({ state: 'idle' }));

    const controller = setupWorkerStatusPolling({
      windowImpl: new EventTarget(),
      chatApi: { getWorkerStatus },
      setIntervalImpl: () => {},
      CustomEventImpl: Event,
    });

    void controller.refresh();
    void controller.refresh();
    expect(getWorkerStatus).toHaveBeenCalledTimes(1);

    resolveFirst(response({ state: 'running' }));
    await tick();
    await tick();
    expect(getWorkerStatus).toHaveBeenCalledTimes(2);
  });
});
