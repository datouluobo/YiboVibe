import { useEffect } from "react";
import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Login from "./pages/Login";
import Layout from "./components/Layout";
// Pages — Flow 全家桶
import FlowDeck from "./pages/FlowDeck";
import FlowMind from "./pages/FlowMind";
import FlowWriter from "./pages/FlowWriter";
import FlowPredict from "./pages/FlowPredict";
import FlowSync from "./pages/FlowSync";
import FlowDrop from "./pages/FlowDrop";
import FlowRules from "./pages/FlowRules";
import Settings from "./pages/Settings";
import "./App.css";

function App() {
  let appWindow: any = null;
  try {
    appWindow = getCurrentWindow();
  } catch (e) {
    console.warn("Not running in Tauri environment, skipping window APIs");
  }

  useEffect(() => {
    const theme = localStorage.getItem('yiboflow_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  return (
    <Router>
      <div className="app-container">
        {/* Tauri Titlebar - Draggable Area */}
        <div
          className="titlebar"
          onPointerDown={(e) => {
            if (e.buttons === 1) {
              appWindow.startDragging();
            }
          }}
        >
          <span className="titlebar-title">YiboFlow</span>
          <div className="titlebar-controls" onPointerDown={(e) => e.stopPropagation()}>
            <div
              className="titlebar-button minimize"
              onClick={() => appWindow.minimize()}
            >
              <svg viewBox="0 0 10 10"><path d="M1 4h8v2H1z" /></svg>
            </div>
            <div
              className="titlebar-button maximize"
              onClick={() => appWindow.toggleMaximize()}
            >
              <svg viewBox="0 0 10 10"><path d="M1 1h8v8H1z" fill="none" stroke="currentColor" /></svg>
            </div>
            <div
              className="titlebar-button close"
              onClick={() => appWindow.close()}
            >
              <svg viewBox="0 0 10 10"><path d="M1 1l8 8m0-8L1 9" stroke="currentColor" strokeWidth="1.5" /></svg>
            </div>
          </div>
        </div>

        {/* Main Routed Content */}
        <div className="main-content" style={{ display: 'flex' }}>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/app" element={<Layout />}>
              <Route index element={<Navigate to="/app/flowdeck" replace />} />
              <Route path="flowdeck" element={<FlowDeck />} />
              <Route path="flowmind" element={<FlowMind />} />
              <Route path="flowwriter" element={<FlowWriter />} />
              <Route path="flowpredict" element={<FlowPredict />} />
              <Route path="flowsync" element={<FlowSync />} />
              <Route path="flowdrop" element={<FlowDrop />} />
              <Route path="flowrules" element={<FlowRules />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
