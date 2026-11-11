export function isRunningStatus(text, cls) {
  return (
    cls === 'running' ||
    text === 'running' ||
    text === 'sending' ||
    text === 'queued' ||
    text === 'accepted' ||
    text === 'cancelling'
  );
}

// Reactive toolbar state shared between the live runtime (chat-composer-runtime.js)
// and the declarative <ChatToolbar>. The runtime mutates these fields; the
// component reads them through bindings. Replaces the former imperative
// getElementById/textContent DOM mutation. Live-only.
export class ChatToolbarState {
  statusText = $state('');
  statusClass = $state('');
  modelLabel = $state('');
  thinkingLevel = $state('');
  knownModelLabel = $state('');
  knownThinkingLevel = $state('');
  // Footer lines published by pi extensions via ctx.ui.setStatus (quota,
  // token speed, ...), keyed by status key and shown sorted like pi's footer.
  extensionStatuses = $state({});
  extensionStatusLines = $derived(
    Object.keys(this.extensionStatuses)
      .sort()
      .map((key) => ({ key, text: this.extensionStatuses[key] })),
  );

  // Injected by the runtime once the context-usage controller exists.
  updateContextUsage = () => {};

  isRunning = $derived(isRunningStatus(this.statusText, this.statusClass));

  setStatus = (text, cls = '') => {
    this.statusText = text;
    this.statusClass = cls;
  };

  setModelLabel = (label) => {
    if (label) this.modelLabel = label;
    this.updateContextUsage();
  };

  setThinkingLabel = (level) => {
    this.thinkingLevel = level || '';
  };

  setExtensionStatuses = (statuses) => {
    this.extensionStatuses = statuses && typeof statuses === 'object' ? statuses : {};
  };

  getKnownModelLabel = () => this.knownModelLabel;
  setKnownModelLabel = (label) => {
    this.knownModelLabel = label;
  };
  getKnownThinkingLevel = () => this.knownThinkingLevel;
  setKnownThinkingLevel = (level) => {
    this.knownThinkingLevel = level;
  };
}
