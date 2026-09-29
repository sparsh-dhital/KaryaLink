/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff", 100: "#d9eaff", 200: "#bcdaff", 300: "#8ec3ff", 400: "#59a2ff",
          500: "#337ffb", 600: "#1d5fef", 700: "#1649d6", 800: "#183dad", 900: "#1a3888", 950: "#142453",
        },
        ink: {
          50: "#f6f7f9", 100: "#eceef2", 200: "#d5dae2", 300: "#b0b9c8", 400: "#8593a9", 500: "#66758e",
          600: "#515e75", 700: "#434d60", 800: "#3a4251", 900: "#262b35", 950: "#161a21",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "-apple-system", "Roboto", "Noto Sans", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.08)",
      },
      keyframes: {
        pulsering: { "0%": { transform: "scale(1)", opacity: ".6" }, "100%": { transform: "scale(1.6)", opacity: "0" } },
        slideup: { "0%": { transform: "translateY(12px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
      },
      animation: {
        pulsering: "pulsering 1.2s ease-out infinite",
        slideup: "slideup .25s ease-out",
      },
    },
  },
  plugins: [],
};
