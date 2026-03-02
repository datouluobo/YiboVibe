import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Login from "./pages/Login";
import Layout from "./components/Layout";
// Pages
import Hub from "./pages/Hub";
import Snippets from "./pages/Snippets";
import AutoFill from "./pages/AutoFill";
import Cloudboard from "./pages/Cloudboard";
import Drop from "./pages/Drop";
import Exemptions from "./pages/Exemptions";
import Predictor from "./pages/Predictor";
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
              <Route index element={<Navigate to="/app/hub" replace />} />
              <Route path="hub" element={<Hub />} />
              <Route path="snippets" element={<Snippets />} />
              <Route path="autofill" element={<AutoFill />} />
              <Route path="cloudboard" element={<Cloudboard />} />
              <Route path="drop" element={<Drop />} />
              <Route path="exemptions" element={<Exemptions />} />
              <Route path="predictor" element={<Predictor />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            {/* Legacy Fallback */}
            <Route path="/dashboard" element={<Navigate to="/app/hub" replace />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
