export function setupComposerHeightVar({
  documentImpl = document,
  windowImpl = window,
  form,
  ResizeObserverImpl = windowImpl.ResizeObserver,
} = {}) {
  if (!form) return { update: () => {}, dispose: () => {} };

  function update() {
    const height = Math.ceil(form.getBoundingClientRect().height || 0);
    documentImpl.documentElement.style.setProperty('--pi-chat-composer-height', `${height}px`);
  }

  update();
  windowImpl.addEventListener('resize', update, { passive: true });
  const resizeObserver = ResizeObserverImpl ? new ResizeObserverImpl(update) : null;
  resizeObserver?.observe(form);

  return {
    update,
    dispose: () => {
      windowImpl.removeEventListener('resize', update, { passive: true });
      resizeObserver?.disconnect();
    },
  };
}
