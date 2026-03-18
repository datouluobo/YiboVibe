
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

// Sync theme across windows via Tauri events
import("@tauri-apps/api/event").then(({ listen }) => {
  listen<string>("theme-changed", (event) => {
    document.documentElement.setAttribute('data-theme', event.payload);
  });
});

const isHintOverlay = window.location.hash.includes('#/hint');
const isWriterOverlay = window.location.hash.includes('#/writer');

console.log("Rendering attempt:", { hash: window.location.hash, isHintOverlay, isWriterOverlay });

if (isHintOverlay || isWriterOverlay) {
  document.body.style.background = 'transparent';
  document.body.style.backgroundImage = 'none';
  document.documentElement.style.background = 'transparent';
}

import { HashRouter } from "react-router-dom";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isHintOverlay ? (
    <HashRouter><HintWindow /></HashRouter>
  ) : isWriterOverlay ? (
    <HashRouter><WriterWindow /></HashRouter>
  ) : (
    <App />
  )
);
