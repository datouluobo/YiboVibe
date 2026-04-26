
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import "./i18n";

const savedTheme = localStorage.getItem('yiboflow_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

import("@tauri-apps/api/event").then(({ listen }) => {
  listen<string>("theme-changed", (event) => {
    document.documentElement.setAttribute('data-theme', event.payload);
  });
});

const isHintOverlay = window.location.hash.includes('#/hint');

if (isHintOverlay) {
  document.body.style.background = 'transparent';
  document.body.style.backgroundImage = 'none';
  document.documentElement.style.background = 'transparent';
}

if (isHintOverlay) {
  import("react-router-dom").then(({ HashRouter }) => {
    import("./pages/HintWindow").then(({ default: HintWindow }) => {
      ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
        <HashRouter><HintWindow /></HashRouter>
      );
    });
  });
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <App />
  );
}
