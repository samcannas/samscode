import React from "react";
import ReactDOM from "react-dom/client";
import { createHashHistory, RouterProvider } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { isMacPlatform } from "./lib/utils";

const history = createHashHistory();

const router = getRouter(history);
const rootElement = document.getElementById("root") as HTMLElement;

document.title = APP_DISPLAY_NAME;

// On Windows / Linux the native title bar is hidden (`frame: false`) and we
// render custom window controls inside the header.  This attribute enables
// CSS adjustments (e.g. extra right padding on drag-region headers).
if (!isMacPlatform(navigator.platform)) {
  document.documentElement.dataset.customTitlebar = "";
}

if (!window.desktopBridge && import.meta.env.MODE !== "test") {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <div className="flex min-h-screen items-center justify-center bg-[#0d1117] px-6 text-center text-[#c9d1d9]">
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-semibold text-white">Desktop App Required</h1>
          <p className="text-sm leading-6 text-[#8b949e]">
            Sam&apos;s Code only runs inside the desktop app. Launch it with `bun run dev` or `bun
            run start`.
          </p>
        </div>
      </div>
    </React.StrictMode>,
  );
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}
