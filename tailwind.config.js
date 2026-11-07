/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Manrope", "system-ui", "sans-serif"],
        display: ["Manrope", "Inter", "system-ui", "sans-serif"],
        lyrics: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        ink: {
          950: "#070708",
          900: "#0b0b0e",
          850: "#101014",
          800: "#141419",
          700: "#1b1b22",
          600: "#26262f",
          500: "#34343f",
        },
        accent: {
          DEFAULT: "var(--accent, #f5a524)",
          soft: "var(--accent-soft, rgba(245,165,36,.18))",
        },
      },
      boxShadow: {
        glass: "0 24px 80px -20px rgba(0,0,0,.7), inset 0 1px 0 0 rgba(255,255,255,.06)",
        glow: "0 0 42px -6px var(--accent-glow, rgba(245,165,36,.55))",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.2, 0, 0, 1)",
      },
      keyframes: {
        "slow-drift": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "33%": { transform: "translate3d(4%, -3%, 0) scale(1.08)" },
          "66%": { transform: "translate3d(-3%, 4%, 0) scale(0.96)" },
        },
        "cover-breathe": {
          "0%, 100%": { transform: "scale(1.18) translateY(0)" },
          "50%": { transform: "scale(1.24) translateY(-1.5%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "dot-pulse": {
          "0%, 80%, 100%": { transform: "scale(0.6)", opacity: "0.3" },
          "40%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "slow-drift": "slow-drift 26s ease-in-out infinite",
        "cover-breathe": "cover-breathe 22s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};
