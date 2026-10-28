/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.js",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        paper: "var(--sr-paper)",
        ink: "var(--sr-ink)",
        mute: "var(--sr-mute)",
        rule: "var(--sr-rule)",
        teal: "var(--sr-teal)",
        gain: "var(--sr-gain)",
        risk: "var(--sr-risk)",
        warn: "var(--sr-warn)",
        card: "var(--sr-card)",
      },
      fontFamily: {
        serif: ["Literata", "Georgia", "serif"],
        sans: ["Instrument Sans", "system-ui", "sans-serif"],
      },
    },
  },
};