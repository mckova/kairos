import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import App from "./App";
import "./styles.css";

// Theme: an explicit choice wins, otherwise follow the operating system.
const saved = localStorage.getItem("kairos.theme");
document.documentElement.dataset.theme = saved === "dark" || saved === "light" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
