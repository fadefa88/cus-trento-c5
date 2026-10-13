// Theme before first paint, to avoid a white flash in dark mode (external file: strict CSP).
try {
  var t = localStorage.getItem("cms-theme") || "system";
  var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
} catch (e) {}
