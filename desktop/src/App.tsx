import { useEffect, useState } from "react";
import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Login from "./pages/Login";
import Layout from "./components/Layout";
// Pages — Flow 全家桶
import FlowDeck from "./pages/FlowDeck";
import FlowMind from "./pages/FlowMind";
import FlowSync from "./pages/FlowSync";
import FlowDrop from "./pages/FlowDrop";
import FlowProbe from "./pages/FlowProbe";
import FlowRules from "./pages/FlowRules";
import Settings from "./pages/Settings";
import FlowInfo from "./pages/FlowInfo";
import HintWindow from "./pages/HintWindow";
import "./App.css";

const appWindow = (() => {
  try { return getCurrentWindow(); } catch { return null; }
})();

function App() {
  const [isMaximized, setIsMaximized] = useState(false);
  const lastClickRef = { time: 0, x: 0, y: 0 };

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

  const handleTitlebarMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !appWindow) return;
    if ((e.target as HTMLElement).closest('.titlebar-controls')) return;

    const now = Date.now();
    const isDoubleClick =
      now - lastClickRef.time < 400 &&
      Math.abs(e.clientX - lastClickRef.x) < 5 &&
      Math.abs(e.clientY - lastClickRef.y) < 5;

    lastClickRef.time = now;
    lastClickRef.x = e.clientX;
    lastClickRef.y = e.clientY;

    if (isDoubleClick) {
      appWindow.toggleMaximize();
    } else {
      appWindow.startDragging();
    }
  };

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

        {/* Main Routed Content */}
        <div className="main-content" style={{ display: 'flex' }}>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/hint" element={<HintWindow />} />
            <Route path="/app" element={<Layout />}>
              <Route index element={<Navigate to="/app/flowdeck" replace />} />
              <Route path="flowdeck" element={<FlowDeck />} />
              <Route path="flowmind" element={<FlowMind />} />
              <Route path="flowsync" element={<FlowSync />} />
              <Route path="flowdrop" element={<FlowDrop />} />
              <Route path="flowprobe" element={<FlowProbe />} />
              <Route path="flowrules" element={<FlowRules />} />
              <Route path="settings" element={<Settings />} />
              <Route path="flowinfo" element={<FlowInfo />} />
            </Route>
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
