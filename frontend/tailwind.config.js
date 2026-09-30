/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // restrained accent: used for primary actions, focus and active states only
        brand: {
          50: "#f2f1ff", 100: "#e6e3ff", 200: "#cfcaff", 300: "#aea5ff", 400: "#8e80fb", 500: "#7565f3",
          600: "#6150e6", 700: "#5241c9", 800: "#4336a3", 900: "#393082", 950: "#221c4d",
        },
        // cool neutral scale for text, surfaces and borders
        ink: {
          25: "#fbfbfd", 50: "#f5f6f9", 100: "#eceef3", 200: "#dfe2ea", 300: "#c5cad6", 400: "#949bad", 500: "#6b7286",
          600: "#4d5367", 700: "#383d4f", 800: "#252836", 850: "#1a1c27", 900: "#12131b", 950: "#0a0b10",
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "Segoe UI", "system-ui", "-apple-system", "Roboto", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', "Consolas", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        xs: "0 1px 2px rgba(15, 20, 30, 0.04)",
        card: "0 1px 2px rgba(15, 20, 30, 0.04), 0 1px 1px rgba(15, 20, 30, 0.02)",
        pop: "0 12px 32px -8px rgba(15, 20, 30, 0.18), 0 4px 8px -4px rgba(15, 20, 30, 0.08)",
        ring: "0 0 0 4px rgba(117, 101, 243, 0.18)",
        glow: "0 0 0 1px rgba(142, 128, 251, 0.25), 0 8px 32px -8px rgba(117, 101, 243, 0.35)",
      },
      borderRadius: {
        xl: "0.875rem",
      },
      keyframes: {
        pulsering: { "0%": { transform: "scale(1)", opacity: ".55" }, "100%": { transform: "scale(1.9)", opacity: "0" } },
        slideup: { "0%": { transform: "translateY(6px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        fadein: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        eq: { "0%,100%": { transform: "scaleY(.35)" }, "50%": { transform: "scaleY(1)" } },
      },
      animation: {
        pulsering: "pulsering 1.4s cubic-bezier(.2,.6,.3,1) infinite",
        slideup: "slideup .22s cubic-bezier(.2,.7,.3,1)",
        fadein: "fadein .18s ease-out",
        shimmer: "shimmer 1.4s infinite",
        eq: "eq .9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
