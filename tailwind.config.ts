import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: {
        "2xl": "1360px",
      },
    },
    extend: {
      screens: {
        "3xl": "1920px",
      },
      colors: {
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        input: "rgb(var(--input) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          3: "rgb(var(--surface-3) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          foreground: "rgb(var(--muted-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          foreground: "rgb(var(--primary-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          foreground: "rgb(var(--accent-foreground) / <alpha-value>)",
        },
        // The one chrome hue. Everything that used to be `cyan` — primary
        // buttons, active nav, focus, live state — is `action` now.
        action: {
          DEFAULT: "rgb(var(--action) / <alpha-value>)",
          foreground: "rgb(var(--action-foreground) / <alpha-value>)",
        },
        code: "rgb(var(--code) / <alpha-value>)",
        amber: "rgb(var(--amber) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",

        // The elevation ramp: deep water → shelf → lowland → upland → ridge →
        // summit. Chart series, leaderboard bars, module glyphs and the hero
        // contours all draw from here, in order. Nothing in the chrome does.
        elev: {
          0: "rgb(var(--elev-0) / <alpha-value>)",
          1: "rgb(var(--elev-1) / <alpha-value>)",
          2: "rgb(var(--elev-2) / <alpha-value>)",
          3: "rgb(var(--elev-3) / <alpha-value>)",
          4: "rgb(var(--elev-4) / <alpha-value>)",
          5: "rgb(var(--elev-5) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--card) / <alpha-value>)",
          foreground: "rgb(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--popover) / <alpha-value>)",
          foreground: "rgb(var(--popover-foreground) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // 12px is the floor for the whole product. It used to be 11px across
        // 454 call sites with a tail of 9px and 10px arbitrary values, which
        // is the single biggest reason the dense surfaces were hard to read.
        "2xs": ["0.75rem", { lineHeight: "1.1rem" }],
        // Long-form reading: chat messages, lesson prose, article bodies.
        // Sits between `sm` and `base` because 16px is too loose for a
        // message list and 14px is too tight to read for minutes at a time.
        body: ["0.9375rem", { lineHeight: "1.6" }],
        // Fraunces is a serif, so it carries less optical weight per pixel
        // than Space Grotesk did — the display sizes lose a little of their
        // negative tracking to compensate.
        "display-sm": ["2.5rem", { lineHeight: "1.08", letterSpacing: "-0.015em" }],
        "display-md": ["4rem", { lineHeight: "1.04", letterSpacing: "-0.022em" }],
        "display-lg": ["6rem", { lineHeight: "1", letterSpacing: "-0.028em" }],
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 10px)",
        "3xl": "calc(var(--radius) + 18px)",
      },
      boxShadow: {
        // `glow` is a hairline ring, not a glow — the name predates the
        // palette. Left alone because 29 call sites rely on the ring.
        hairline: "0 0 0 1px rgb(var(--border) / 1)",
        glow: "0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 0 0 1px rgb(var(--border) / 1)",
        lift: "0 20px 50px -20px rgb(0 0 0 / 0.45)",
        float: "0 30px 80px -28px rgb(0 0 0 / 0.55)",
      },
      backgroundImage: {
        // A hypsometric wash, deep water to summit. The one gradient Terrain
        // keeps, because it is not decoration — it is the legend for the ramp.
        "gradient-elevation":
          "linear-gradient(90deg, rgb(var(--elev-0)) 0%, rgb(var(--elev-1)) 20%, rgb(var(--elev-2)) 40%, rgb(var(--elev-3)) 60%, rgb(var(--elev-4)) 80%, rgb(var(--elev-5)) 100%)",
        grid: "linear-gradient(rgb(var(--border) / 0.7) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border) / 0.7) 1px, transparent 1px)",
      },
      letterSpacing: {
        tightest: "-0.03em",
        // Map legends and survey labels are letterspaced, not tightened.
        legend: "0.12em",
      },
      keyframes: {
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgb(var(--amber) / 0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgb(var(--amber) / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(var(--amber) / 0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "border-flow": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "caret-blink": {
          "0%, 70%, 100%": { opacity: "1" },
          "20%, 50%": { opacity: "0" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        shimmer: "shimmer 2s infinite",
        "gradient-x": "gradient-x 6s ease infinite",
        float: "float 6s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        "fade-up": "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both",
        "border-flow": "border-flow 4s ease infinite",
        "caret-blink": "caret-blink 1.1s steps(1) infinite",
        "spin-slow": "spin-slow 16s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
