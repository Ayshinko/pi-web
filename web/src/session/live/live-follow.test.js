import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createFollowScrollController } from './live-follow.js';

function setup({ scrollHeight = 2000, innerHeight = 1000 } = {}) {
  const dom = new JSDOM('<body><main id="content"></main></body>');
  const documentImpl = dom.window.document;
  Object.defineProperty(documentImpl.documentElement, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(documentImpl.body, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });

  const handlers = {};
  const windowImpl = {
    scrollY: 0,
    pageYOffset: 0,
    innerHeight,
    scrollTo: vi.fn(),
    setTimeout: (cb) => {
      cb();
      return 0;
    },
    requestAnimationFrame: (cb) => {
      cb();
      return 0;
    },
    addEventListener: (type, handler) => {
      (handlers[type] ||= []).push(handler);
    },
    removeEventListener: (type, handler) => {
      handlers[type] = (handlers[type] || []).filter((h) => h !== handler);
    },
  };
  const fire = (type, extra = {}) => (handlers[type] || []).forEach((h) => h({ type, ...extra }));

  const controller = createFollowScrollController({
    documentImpl,
    windowImpl,
    requestAnimationFrameImpl: (cb) => {
      cb();
      return 0;
    },
    setTimeoutImpl: (cb) => {
      cb();
      return 0;
    },
  });
  return { dom, documentImpl, windowImpl, handlers, fire, controller };
}

describe('createFollowScrollController', () => {
  it('starts following and scrolls to bottom on init', () => {
    const { windowImpl, controller } = setup();
    expect(controller.isFollowing()).toBe(true);
    expect(controller.shouldFollow()).toBe(true);
    expect(windowImpl.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('stops following and shows the follow button when scrolled away from bottom', () => {
    const { documentImpl, windowImpl, fire, controller } = setup();
    windowImpl.scrollY = 0; // remaining = 2000 - 0 - 1000 = 1000 (> threshold)
    fire('scroll');
    expect(controller.isFollowing()).toBe(false);
    expect(documentImpl.querySelector('.follow-button')).not.toBeNull();
  });

  it('keeps following on a downward scrollTop clamp that stays at the bottom', () => {
    const { documentImpl, windowImpl, fire, controller } = setup();
    windowImpl.scrollY = 1000; // remaining = 2000 - 1000 - 1000 = 0 (at bottom)
    fire('scroll');
    expect(controller.isFollowing()).toBe(true);
    // The document shrinks when the streaming preview is finalized/removed, so
    // the browser clamps scrollTop downward — but we are still at the bottom.
    windowImpl.scrollY = 960; // remaining = 40 (< 80 threshold, still at bottom)
    fire('scroll');
    expect(controller.isFollowing()).toBe(true);
    expect(documentImpl.querySelector('.follow-button')).toBeNull();
  });

  it('releases forced follow when the user scrolls up away from the bottom', () => {
    const { windowImpl, fire, controller } = setup();
    windowImpl.scrollY = 1000;
    fire('scroll');
    controller.extendPreviewFollow(30000);
    expect(controller.shouldFollow()).toBe(true);
    windowImpl.scrollY = 0; // remaining = 1000 (away from bottom) and scrolled up
    fire('scroll');
    expect(controller.isFollowing()).toBe(false);
    expect(controller.shouldFollow()).toBe(false);
  });

  it('clicking the follow button re-follows and removes the button', () => {
    const { documentImpl, windowImpl, fire, controller } = setup();
    fire('scroll');
    const btn = documentImpl.querySelector('.follow-button');
    expect(btn).not.toBeNull();
    windowImpl.scrollTo.mockClear();
    btn.click();
    expect(windowImpl.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
    expect(documentImpl.querySelector('.follow-button')).toBeNull();
    expect(controller.isFollowing()).toBe(true);
  });

  it('extendPreviewFollow keeps shouldFollow true while not following', () => {
    const { fire, controller } = setup();
    fire('scroll'); // following becomes false
    expect(controller.shouldFollow()).toBe(false);
    controller.extendPreviewFollow(30000);
    expect(controller.shouldFollow()).toBe(true);
  });

  it('forceFollowToBottom re-follows and scrolls', () => {
    const { windowImpl, fire, controller } = setup();
    fire('scroll');
    expect(controller.isFollowing()).toBe(false);
    windowImpl.scrollTo.mockClear();
    controller.forceFollowToBottom(true);
    expect(controller.isFollowing()).toBe(true);
    expect(windowImpl.scrollTo).toHaveBeenCalled();
  });

  it('ignores non-scrolling keys for follow decisions', () => {
    const { fire, controller } = setup();
    fire('keydown', { key: 'a' });
    expect(controller.isFollowing()).toBe(true);
  });

  it('keeps following while our own smooth scroll is still moving down', () => {
    const { documentImpl, windowImpl, fire, controller } = setup({ scrollHeight: 4000 });
    windowImpl.scrollY = 3000;
    fire('scroll'); // at bottom
    windowImpl.scrollY = 1200; // user drags up: release
    fire('scroll');
    expect(controller.isFollowing()).toBe(false);
    controller.forceFollowToBottom(true);
    windowImpl.scrollY = 2000; // mid-flight of the smooth scroll, not yet at bottom
    fire('scroll');
    expect(controller.isFollowing()).toBe(true);
    expect(documentImpl.querySelector('.follow-button')).toBeNull();
  });

  it('pins to the bottom when the message list grows while following', () => {
    const dom = new JSDOM('<body><main id="content"><div id="messages"></div></main></body>');
    const documentImpl = dom.window.document;
    for (const el of [documentImpl.documentElement, documentImpl.body]) {
      Object.defineProperty(el, 'scrollHeight', { value: 3000, configurable: true });
    }
    const messages = documentImpl.getElementById('messages');
    let height = 500;
    messages.getBoundingClientRect = () => ({ height });
    let observerCallback = null;
    const disconnect = vi.fn();
    class FakeResizeObserver {
      constructor(cb) {
        observerCallback = cb;
      }
      observe() {}
      disconnect = disconnect;
    }
    const handlers = {};
    const windowImpl = {
      scrollY: 0,
      innerHeight: 1000,
      scrollTo: vi.fn(),
      addEventListener: (type, h) => (handlers[type] ||= []).push(h),
      removeEventListener: () => {},
    };
    const controller = createFollowScrollController({
      documentImpl,
      windowImpl,
      requestAnimationFrameImpl: (cb) => cb(),
      setTimeoutImpl: (cb) => cb(),
      ResizeObserverImpl: FakeResizeObserver,
    });
    windowImpl.scrollTo.mockClear();

    height = 900;
    observerCallback();
    expect(windowImpl.scrollTo).toHaveBeenCalledTimes(1);

    windowImpl.scrollTo.mockClear();
    handlers.wheel.forEach((h) => h({ type: 'wheel' })); // user takes over (not at bottom)
    height = 1400;
    observerCallback();
    expect(controller.isFollowing()).toBe(false);
    expect(windowImpl.scrollTo).not.toHaveBeenCalled();

    controller.dispose();
    expect(disconnect).toHaveBeenCalled();
  });

  it('dispose removes listeners so later scrolls no longer change state', () => {
    const { fire, controller } = setup();
    controller.dispose();
    fire('scroll');
    expect(controller.isFollowing()).toBe(true);
  });
});
