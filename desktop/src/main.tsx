import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import "./i18n";

import HintWindow from "./pages/HintWindow";

const savedTheme = localStorage.getItem('yiboflow_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

const isHintOverlay = window.location.hash === '#/hint';

if (isHintOverlay) {
  document.body.style.background = 'transparent';
  document.documentElement.style.background = 'transparent';
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isHintOverlay ? <HintWindow /> : <App />}
  </React.StrictMode>,
);
