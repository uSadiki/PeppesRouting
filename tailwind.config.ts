import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        peppes: {
          red: "#D32027",
          dark: "#0E0E10",
          panel: "#15151A",
          border: "#26262E",
          subtle: "#9A9AA8",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(211,32,39,0.35), 0 8px 24px -8px rgba(211,32,39,0.4)",
      },
    },
  },
  plugins: [],
};

export default config;
