import { useEffect, useState, useRef, useCallback, Suspense, lazy } from "react";
import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Login from "./pages/Login";
import Layout from "./components/Layout";

const FlowDeck = lazy(() => import("./pages/FlowDeck"));
const FlowMind = lazy(() => import("./pages/FlowMind"));
const FlowSync = lazy(() => import("./pages/FlowSync"));
const FlowDrop = lazy(() => import("./pages/FlowDrop"));
const FlowProbe = lazy(() => import("./pages/FlowProbe"));
const FlowRules = lazy(() => import("./pages/FlowRules"));
const Settings = lazy(() => import("./pages/Settings"));
const FlowInfo = lazy(() => import("./pages/FlowInfo"));
const FlowKeys = lazy(() => import("./pages/FlowKeys"));
const HintWindow = lazy(() => import("./pages/HintWindow"));
const Admin = lazy(() => import("./pages/Admin"));

import "./App.css";

const appWindow = (() => {
  try { return getCurrentWindow(); } catch { return null; }
})();

function PageFallback() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: 'var(--color-text-muted)', fontSize: '13px',
    }}>
      Loading...
    </div>
  );
}

function App() {
  const [isMaximized, setIsMaximized] = useState(false);
  const lastClickRef = useRef({ time: 0, x: 0, y: 0 });

  useEffect(() => {
    const theme = localStorage.getItem('yiboflow_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  useEffect(() => {
    if (!appWindow) return;
    appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  const handleTitlebarMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !appWindow) return;
    if ((e.target as HTMLElement).closest('.titlebar-controls')) return;

    const now = Date.now();
    const ref = lastClickRef.current;
    const isDoubleClick =
      now - ref.time < 400 &&
      Math.abs(e.clientX - ref.x) < 5 &&
      Math.abs(e.clientY - ref.y) < 5;

    ref.time = now;
    ref.x = e.clientX;
    ref.y = e.clientY;

    if (isDoubleClick) {
      appWindow.toggleMaximize();
    } else {
      appWindow.startDragging();
    }
  }, []);

  return (
    <Router>
      <div className="app-container">
        <div
          className="titlebar"
          onMouseDown={handleTitlebarMouseDown}
        >
          <span className="titlebar-title">YiboFlow</span>
          <div className="titlebar-controls">
            <button
              className="titlebar-button minimize"
              onClick={() => appWindow?.minimize()}
            >
              <svg viewBox="0 0 10 10"><path d="M1 4h8v2H1z" fill="currentColor" /></svg>
            </button>
            <button
              className="titlebar-button maximize"
              onClick={() => appWindow?.toggleMaximize()}
            >
              {isMaximized ? (
                <svg viewBox="0 0 10 10"><path d="M2.5 3.5h4v4h-4z" fill="none" stroke="currentColor" strokeWidth="1" /><path d="M3.5 3.5V2h4v4H6" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
              ) : (
                <svg viewBox="0 0 10 10"><path d="M1 1h8v8H1z" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
              )}
            </button>
            <button
              className="titlebar-button close"
              onClick={() => appWindow?.close()}
            >
              <svg viewBox="0 0 10 10"><path d="M1 1l8 8m0-8L1 9" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
          </div>
        </div>

        <div className="main-content" style={{ display: 'flex' }}>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/hint" element={<Suspense fallback={<PageFallback />}><HintWindow /></Suspense>} />
            <Route path="/app" element={<Layout />}>
              <Route index element={<Navigate to="/app/flowdeck" replace />} />
              <Route path="flowdeck" element={<Suspense fallback={<PageFallback />}><FlowDeck /></Suspense>} />
              <Route path="flowmind" element={<Suspense fallback={<PageFallback />}><FlowMind /></Suspense>} />
              <Route path="flowsync" element={<Suspense fallback={<PageFallback />}><FlowSync /></Suspense>} />
              <Route path="flowdrop" element={<Suspense fallback={<PageFallback />}><FlowDrop /></Suspense>} />
              <Route path="flowprobe" element={<Suspense fallback={<PageFallback />}><FlowProbe /></Suspense>} />
              <Route path="flowrules" element={<Suspense fallback={<PageFallback />}><FlowRules /></Suspense>} />
              <Route path="settings" element={<Suspense fallback={<PageFallback />}><Settings /></Suspense>} />
              <Route path="flowinfo" element={<Suspense fallback={<PageFallback />}><FlowInfo /></Suspense>} />
              <Route path="flowkeys" element={<Suspense fallback={<PageFallback />}><FlowKeys /></Suspense>} />
              <Route path="admin" element={<Suspense fallback={<PageFallback />}><Admin /></Suspense>} />
            </Route>
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
