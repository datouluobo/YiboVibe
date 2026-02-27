import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import "./App.css";

function App() {
  const appWindow = getCurrentWindow();

  return (
    <Router>
      <div className="app-container">
        {/* Tauri Titlebar - Draggable Area */}
        <div data-tauri-drag-region className="titlebar">
          <span className="titlebar-title" data-tauri-drag-region>YiboFlow</span>
          <div className="titlebar-controls">
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
        <div className="main-content">
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
