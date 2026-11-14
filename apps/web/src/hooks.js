import { useEffect, useRef, useState } from "react";

/**
 * Subscribes to the live run stream (Server-Sent Events). Returns recent log lines,
 * the latest known state of each run, and whether the stream is connected.
 */
export function useLiveFeed({ runId, enabled = true, limit = 400 } = {}) {
  const [lines, setLines] = useState([]);
  const [runs, setRuns] = useState({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    setLines([]);
    setRuns({});
    const es = new EventSource(`/api/runs/live${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("logs", (e) => {
      const batch = JSON.parse(e.data);
      if (!batch.length) return;
      setLines((prev) => {
        const seen = new Set(prev.map((l) => l._id));
        const merged = [...prev, ...batch.filter((l) => !seen.has(l._id))];
        return merged.length > limit ? merged.slice(-limit) : merged;
      });
    });
    es.addEventListener("runs", (e) => {
      const batch = JSON.parse(e.data);
      setRuns((prev) => {
        const next = { ...prev };
        for (const run of batch) next[run._id] = run;
        return next;
      });
    });
    return () => {
      es.close();
      setConnected(false);
    };
  }, [runId, enabled, limit]);

  return { lines, runs, connected };
}

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
