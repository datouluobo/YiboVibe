
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import "./i18n";

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

import HintWindow from "./pages/HintWindow";
import { HashRouter } from "react-router-dom";

const isHintOverlay = window.location.hash.includes('#/hint');

console.log("Rendering attempt:", { hash: window.location.hash, isHintOverlay });

if (isHintOverlay) {
  document.body.style.background = 'transparent';
  document.body.style.backgroundImage = 'none';
  document.documentElement.style.background = 'transparent';
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isHintOverlay ? (
    <HashRouter><HintWindow /></HashRouter>
  ) : (
    <App />
  )
);
