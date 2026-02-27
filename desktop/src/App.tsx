import { useState } from "react";
import { BrowserRouter as Router, Routes, Route, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import "./App.css";

function App() {
  return (
    <Router>
      <div className="app-container">
        {/* Tauri Titlebar - Draggable Area */}
        <div data-tauri-drag-region className="titlebar">
          <span className="titlebar-title">YiboFlow</span>
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
