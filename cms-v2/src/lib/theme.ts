import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    try {
      return (localStorage.getItem("cms-theme") as ThemeChoice) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    apply(choice);
    try {
      localStorage.setItem("cms-theme", choice);
    } catch {
      /* private browsing */
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => choice === "system" && apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);
  return [choice, setChoice] as const;
}
