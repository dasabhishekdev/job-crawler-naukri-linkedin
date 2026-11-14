import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const LABELS = { linkedin: "LinkedIn", naukri: "Naukri" };
const DONE_STATES = new Set(["connected", "closed", "error", "busy"]);
const SPECIAL_KEYS = new Set(["Enter", "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Home", "End"]);
const TOOLBAR_H = 112;

function pickViewport() {
  const mobile = window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
  if (!mobile) return { width: 1280, height: 800, mobile: false };
  return { width: Math.min(window.innerWidth, 480), height: Math.max(560, window.innerHeight - TOOLBAR_H), mobile: true };
}

/** Full-screen private login window that streams a server-side browser and forwards taps and typing. */
export function PortalLogin({ portal, onClose, onConnected }) {
  const label = LABELS[portal];
  const imgRef = useRef(null);
  const inputRef = useRef(null);
  const wsRef = useRef(null);
  const frameSize = useRef({ width: 1, height: 1 });
  const pointer = useRef(null);
  const [state, setState] = useState({ state: "starting", message: "Preparing a private window…" });
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const viewport = pickViewport();
    api
      .connectPortal(portal, viewport)
      .then(({ ticket, ws_path }) => {
        if (cancelled) return;
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${window.location.host}${ws_path}?ticket=${encodeURIComponent(ticket)}`);
        wsRef.current = ws;
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === "frame") {
            frameSize.current = { width: msg.width, height: msg.height };
            if (imgRef.current) imgRef.current.src = `data:image/jpeg;base64,${msg.data}`;
            setHasFrame(true);
          } else if (msg.type === "status") {
            setState({ state: msg.state, message: msg.message });
            if (msg.state === "connected") setTimeout(() => onConnected?.(), 1200);
          }
        };
        ws.onclose = () => setState((s) => (DONE_STATES.has(s.state) ? s : { state: "closed", message: "The login window closed." }));
        ws.onerror = () => setState({ state: "error", message: "Could not reach the login service. Try again in a moment." });
      })
      .catch((err) => setState({ state: "error", message: err.message }));
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [portal, onConnected]);

  function send(msg) {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }

  function toPage(clientX, clientY) {
    const rect = imgRef.current.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * frameSize.current.width,
      y: ((clientY - rect.top) / rect.height) * frameSize.current.height,
      scale: frameSize.current.height / rect.height,
    };
  }

  function onPointerDown(e) {
    pointer.current = { x: e.clientX, y: e.clientY, lastY: e.clientY, moved: false };
  }

  function onPointerMove(e) {
    const p = pointer.current;
    if (!p) return;
    const dy = p.lastY - e.clientY;
    if (Math.abs(e.clientY - p.y) > 8) p.moved = true;
    if (p.moved && Math.abs(dy) > 4) {
      const pos = toPage(e.clientX, e.clientY);
      send({ t: "scroll", x: pos.x, y: pos.y, dy: Math.round(dy * pos.scale * 1.5) });
      p.lastY = e.clientY;
    }
  }

  function onPointerUp(e) {
    const p = pointer.current;
    pointer.current = null;
    if (!p || p.moved) return;
    const pos = toPage(e.clientX, e.clientY);
    send({ t: "tap", x: pos.x, y: pos.y });
    inputRef.current?.focus({ preventScroll: true });
  }

  function onWheel(e) {
    const pos = toPage(e.clientX, e.clientY);
    send({ t: "scroll", x: pos.x, y: pos.y, dy: Math.round(e.deltaY) });
  }

  function onInput(e) {
    const { inputType, data } = e.nativeEvent;
    if (inputType === "deleteContentBackward") send({ t: "key", key: "Backspace" });
    else if (data) send({ t: "text", text: data });
    else if (e.target.value) send({ t: "text", text: e.target.value });
    e.target.value = "";
  }

  function onKeyDown(e) {
    if (SPECIAL_KEYS.has(e.key)) {
      e.preventDefault();
      send({ t: "key", key: e.key });
    } else if (e.key === "Backspace" && !e.target.value) {
      e.preventDefault();
      send({ t: "key", key: "Backspace" });
    }
  }

  const done = DONE_STATES.has(state.state);

  return (
    <div className="portal-login" role="dialog" aria-modal="true" aria-label={`Sign in to ${label}`}>
      <header className="portal-login-bar">
        <div className="min0">
          <p className="strong">Sign in to {label}</p>
          <p className="small muted truncate">{state.message}</p>
        </div>
        <div className="row gap">
          {!done ? (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => send({ t: "back" })} aria-label="Back">
                ←
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.focus()} aria-label="Show keyboard">
                ⌨
              </button>
            </>
          ) : null}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            {state.state === "connected" ? "Done" : "Close"}
          </button>
        </div>
      </header>
      <p className="portal-login-note">
        This is a private browser on our server. We never see or store your password; only the signed-in session is saved,
        encrypted.
      </p>
      <div className="portal-login-stage">
        {state.state === "connected" ? (
          <div className="portal-login-msg">
            <p className="portal-login-ok">✓ {label} connected</p>
            <p className="muted">Recommended and matching jobs will appear in your Jobs list after the next portal search.</p>
          </div>
        ) : done ? (
          <div className="portal-login-msg">
            <p className="strong">{state.message}</p>
          </div>
        ) : (
          <>
            {!hasFrame ? (
              <div className="portal-login-msg">
                <span className="spinner spinner-lg" />
              </div>
            ) : null}
            <img
              ref={imgRef}
              alt={`${label} login page`}
              className={`portal-login-frame ${hasFrame ? "" : "is-hidden"}`}
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => (pointer.current = null)}
              onWheel={onWheel}
            />
          </>
        )}
        <input
          ref={inputRef}
          className="portal-login-input"
          aria-label="Type into the login page"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck="false"
          onInput={onInput}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
