import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import "./i18n";

import HintWindow from "./pages/HintWindow";
import WriterWindow from "./pages/WriterWindow";

const savedTheme = localStorage.getItem('yiboflow_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

// Disable the default browser right-click context menu globally to enforce native app immersion
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

const isHintOverlay = window.location.hash === '#/hint';
const isWriterOverlay = window.location.hash === '#/writer';

if (isHintOverlay || isWriterOverlay) {
  document.body.style.background = 'transparent';
  document.documentElement.style.background = 'transparent';
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isHintOverlay ? <HintWindow /> : (isWriterOverlay ? <WriterWindow /> : <App />)}
  </React.StrictMode>,
);
