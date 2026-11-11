// Live-only DOM/runtime glue for the chat composer, extracted from
// ChatComposer.svelte so the component stays declarative. Kept DI-friendly so
// tests can drive it directly and inject selector implementations.
import { THINKING_LEVELS } from '../../../session/chat/chat-selectors.js';
import { setupModelSelector } from './model-selector.js';
import { setupThinkingLevelSelector } from './thinking-selector.js';
import { setupSlashCommands } from './slash-command.js';
import { setupMentionAutocomplete } from './mention-autocomplete.js';
import { createContextUsageController } from './context-usage.js';
import { setupComposerExpansion } from './composer-expand.js';
import { setupWorkerStatusPolling } from './worker-status.js';
import { setupAskQuestionHandlers } from './ask-question-handler.js';
import { readComposerConfig } from './composer-config.js';
import { getComposerElements } from './composer-elements.js';
import { setupContextPopover } from './context-popover.js';
import { setupTextareaControls } from './textarea-controls.js';
import { setupAttachmentManager } from './attachment-manager.js';
import { setupCwdCopy } from './cwd-copy.js';
import { setupComposerHeightVar } from './composer-height.js';
import { createComposerSendState } from './composer-send-state.js';
import { getComposerStorage } from './composer-storage.js';
import { navigateInitialChatLeaf } from './initial-navigation.js';
import { ChatToolbarState } from './chat-toolbar-state.svelte.js';
import { setupChatSubmission } from './chat-submit.js';
import { setupSteerQueue } from './steer-queue.js';
import { QueueStore } from './queue-store.svelte.js';
import { createChatSelectorLoaders } from './selector-loaders.js';

export function runChatComposer({
  documentImpl = document,
  windowImpl = window,
  locationImpl = windowImpl.location,
  localEntries = [],
  leafId = '',
  urlTargetId = '',
  byId = new Map(),
  navigateTo = () => {},
  escapeHtml = (text) => String(text),
  chatApi,
  chatSelectors = { THINKING_LEVELS },
  modelSelector = { setupModelSelector },
  thinkingSelector = { setupThinkingLevelSelector },
  slashSelector = { setupSlashCommands },
  mentionSelector = { setupMentionAutocomplete },
  FormDataImpl = FormData,
  URLSearchParamsImpl = URLSearchParams,
  CustomEventImpl = CustomEvent,
  setIntervalImpl = setInterval,
  toolbar = new ChatToolbarState(),
  queueStore = new QueueStore(),
  queueApi = null,
  getLiveEntries = null,
  clearIntervalImpl = clearInterval,
} = {}) {
  const document = documentImpl;
  const window = windowImpl;
  const location = locationImpl;
  const entries = localEntries;
  const __piChatApi = chatApi;
  const __piChatSelectors = chatSelectors;
  const __piModelSelector = modelSelector;
  const __piThinkingSelector = thinkingSelector;
  const __piSlashSelector = slashSelector;
  const __piMentionSelector = mentionSelector;
  const FormData = FormDataImpl;
  const URLSearchParams = URLSearchParamsImpl;
  const CustomEvent = CustomEventImpl;
  const setInterval = setIntervalImpl;
  // Everything that listens on document/window or runs a timer registers its
  // teardown here; the returned dispose() runs them when <ChatComposer>
  // unmounts, so SPA navigation does not stack duplicate handlers (one click on
  // an ask-question answer used to send once per session page ever opened).
  const disposers = [];
  let onWorkerModelUpdate = null;
  let currentModelForThinking = null;
  let positionPopover = () => {};
  const contextUsage = createContextUsageController({
    documentImpl: document,
    entries,
    chatApi,
    getKnownModelLabel: () => toolbar.knownModelLabel,
    positionPopover: () => positionPopover(),
  });
  const updateContextUsage = () => contextUsage.update();
  toolbar.updateContextUsage = updateContextUsage;

  function isMobileTextInputMode() {
    return !!(
      window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches
    );
  }

  const setChatStatus = toolbar.setStatus;
  const setModelLabel = toolbar.setModelLabel;
  const setThinkingLabel = toolbar.setThinkingLabel;
  const selectorLoaders = createChatSelectorLoaders({
    documentImpl: document,
    windowImpl: window,
    locationImpl: location,
    URLSearchParamsImpl: URLSearchParams,
    entries,
    chatApi: __piChatApi,
    escapeHtml,
    modelSelector: __piModelSelector,
    thinkingSelector: __piThinkingSelector,
    slashSelector: __piSlashSelector,
    mentionSelector: __piMentionSelector,
    setModelLabel,
    setChatStatus,
    setThinkingLabel,
    setKnownModelLabel: toolbar.setKnownModelLabel,
    getKnownModelLabel: toolbar.getKnownModelLabel,
    setCurrentModelForThinking: (model) => {
      currentModelForThinking = model;
    },
    setWorkerModelUpdate: (handler) => {
      onWorkerModelUpdate = handler;
    },
    getCurrentModelForThinking: () => currentModelForThinking,
    getKnownThinkingLevel: toolbar.getKnownThinkingLevel,
    setKnownThinkingLevel: toolbar.setKnownThinkingLevel,
  });

  function setupPiChatComposer() {
    const form = document.getElementById('pi-chat-composer');
    const composerConfig = readComposerConfig({ form, setChatStatus });
    if (!composerConfig.ready) return false;
    const { sessionId } = composerConfig;
    const {
      textarea,
      fileInput,
      attachButton,
      attachmentList,
      sendButton,
      cancelButton,
      queueButton,
      shell,
      expandButton,
    } = getComposerElements({ documentImpl: document, form });

    const composerHeight = setupComposerHeightVar({
      documentImpl: document,
      windowImpl: window,
      form,
    });
    disposers.push(composerHeight.dispose);
    const updateComposerHeightVar = composerHeight.update;

    // Expand/collapse the composer for larger typing area. State persists
    // per-session in localStorage.
    let attachments = { hasAttachments: () => false };
    const sendState = createComposerSendState({
      textarea,
      sendButton,
      getAttachments: () => attachments,
    });
    const updateSendEnabled = sendState.updateSendEnabled;

    attachments = setupAttachmentManager({
      documentImpl: document,
      windowImpl: window,
      textarea,
      fileInput,
      attachButton,
      attachmentList,
      updateSendEnabled,
    });
    disposers.push(attachments.dispose);

    const textareaControls = setupTextareaControls({
      windowImpl: window,
      textarea,
      shell,
      form,
      isMobileTextInputMode,
      getSlashSelector: () => _slashSelectorApi,
      getMentionSelector: () => _mentionSelectorApi,
      getThinkingSelector: () => _thinkingSelectorApi,
      getModelSelector: () => _modelSelectorApi,
      updateSendEnabled,
      updateComposerHeight: updateComposerHeightVar,
    });
    disposers.push(textareaControls.dispose);
    const autoResizeTextarea = textareaControls.autoResize;

    setupComposerExpansion({
      sessionId,
      shell,
      expandButton,
      textarea,
      storage: getComposerStorage({ windowImpl: window }),
      onHeightChange: updateComposerHeightVar,
    });

    function setStatus(text, cls) {
      setChatStatus(text, cls);
    }

    const submission = setupChatSubmission({
      windowImpl: window,
      form,
      textarea,
      sendButton,
      cancelButton,
      attachments,
      chatApi: __piChatApi,
      sessionId,
      setStatus,
      autoResizeTextarea,
      updateSendEnabled,
      FormDataImpl: FormData,
      CustomEventImpl: CustomEvent,
    });

    const askQuestions = setupAskQuestionHandlers({
      documentImpl: document,
      sendChatMessage: submission.sendChatMessage,
    });
    disposers.push(askQuestions.dispose);

    const steerQueue = setupSteerQueue({
      windowImpl: window,
      store: queueStore,
      queueButton,
      textarea,
      attachments,
      sendChatMessage: submission.sendChatMessage,
      autoResizeTextarea,
      updateSendEnabled,
      queueApi,
      getLiveEntries,
    });
    disposers.push(steerQueue.dispose);

    const workerStatus = setupWorkerStatusPolling({
      windowImpl: window,
      chatApi: __piChatApi,
      sessionId,
      setStatus,
      setModelLabel,
      setThinkingLabel,
      setExtensionStatuses: toolbar.setExtensionStatuses,
      updateContextUsage,
      getKnownModelLabel: toolbar.getKnownModelLabel,
      setKnownModelLabel: toolbar.setKnownModelLabel,
      getKnownThinkingLevel: toolbar.getKnownThinkingLevel,
      setKnownThinkingLevel: toolbar.setKnownThinkingLevel,
      getWorkerModelUpdate: () => onWorkerModelUpdate,
      setIntervalImpl: setInterval,
      clearIntervalImpl,
      CustomEventImpl: CustomEvent,
    });
    disposers.push(workerStatus.dispose);
    submission.setRefreshWorkerStatus(workerStatus.refresh);

    // Focus the message textarea on page load so the user can start typing immediately.
    if (textarea && typeof textarea.focus === 'function') {
      textarea.focus();
    }

    const contextPopover = setupContextPopover({
      documentImpl: document,
      windowImpl: window,
      updateContextUsage,
    });
    positionPopover = contextPopover.position;
    disposers.push(contextPopover.dispose);

    return true;
  }

  let _modelSelectorApi = null;
  let _thinkingSelectorApi = null;
  let _slashSelectorApi = null;
  let _mentionSelectorApi = null;

  function initPiChatControls() {
    setupCwdCopy({ documentImpl: document, windowImpl: window });
    if (!setupPiChatComposer()) return;

    _modelSelectorApi = selectorLoaders.loadModelSelector();
    _thinkingSelectorApi = selectorLoaders.loadThinkingSelector();
    _slashSelectorApi = selectorLoaders.loadSlashSelector();
    _mentionSelectorApi = selectorLoaders.loadMentionSelector();
    for (const selector of [
      _modelSelectorApi,
      _thinkingSelectorApi,
      _slashSelectorApi,
      _mentionSelectorApi,
    ]) {
      disposers.push(selector?.dispose);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPiChatControls);
  } else {
    initPiChatControls();
  }

  navigateInitialChatLeaf({ entries, leafId, urlTargetId, byId, navigateTo });

  return {
    dispose: () => {
      document.removeEventListener('DOMContentLoaded', initPiChatControls);
      for (const dispose of disposers.splice(0)) dispose?.();
    },
  };
}
