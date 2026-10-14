const INDEX = '__garageHistoryIndex';

/** Restore a traversal before asking, keeping the mounted form and Next's history state. */
export function installHistoryGuard(blocked: () => boolean, request: (action: () => void) => void) {
  const history = window.history;
  const push = history.pushState;
  const replace = history.replaceState;
  let index: number = history.state?.[INDEX] ?? 0;
  let restoring: { index: number; resume: number } | null = null;
  let replay = false;
  let active = true;
  replace.call(history, { ...history.state, [INDEX]: index }, '');
  const wrappedPush: History['pushState'] = function (this: History, state, unused, url) {
    if (!active) {
      push.call(this, state, unused, url);
      return;
    }
    const next = index + 1;
    push.call(this, { ...state, [INDEX]: next }, unused, url);
    index = next;
  };
  const wrappedReplace: History['replaceState'] = function (this: History, state, unused, url) {
    if (!active) {
      replace.call(this, state, unused, url);
      return;
    }
    replace.call(this, { ...state, [INDEX]: index }, unused, url);
  };
  history.pushState = wrappedPush;
  history.replaceState = wrappedReplace;
  const pop = (event: PopStateEvent) => {
    const target: number | undefined = event.state?.[INDEX];
    // Entries outside this document use the browser's beforeunload protection.
    if (target === undefined) return;
    if (restoring) {
      event.stopImmediatePropagation();
      if (target !== restoring.index) {
        history.go(restoring.index - target);
        return;
      }
      const delta = restoring.resume;
      restoring = null;
      request(() => {
        replay = true;
        history.go(delta);
      });
      return;
    }
    if (replay || !blocked() || target === index) {
      replay = false;
      index = target;
      return;
    }
    event.stopImmediatePropagation();
    restoring = { index, resume: target - index };
    history.go(index - target);
  };
  window.addEventListener('popstate', pop, true);
  return () => {
    // Next can retain a bound wrapper through StrictMode effect cleanup/reinstallation.
    active = false;
    window.removeEventListener('popstate', pop, true);
    if (history.pushState === wrappedPush) history.pushState = push;
    if (history.replaceState === wrappedReplace) history.replaceState = replace;
  };
}
