
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
