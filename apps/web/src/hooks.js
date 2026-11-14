import { useEffect, useRef } from "react";

/** Calls `fn` now and every `ms` while `enabled`; pauses while the tab is hidden. */
export function usePoll(fn, ms, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const tick = () => {
      if (document.visibilityState === "visible") saved.current();
    };
    tick();
    timer = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, enabled]);
}
