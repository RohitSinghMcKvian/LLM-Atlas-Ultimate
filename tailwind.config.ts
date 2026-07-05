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
        cyan: "rgb(var(--cyan) / <alpha-value>)",
        violet: "rgb(var(--violet) / <alpha-value>)",
        amber: "rgb(var(--amber) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
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
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        "display-sm": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        "display-md": ["4rem", { lineHeight: "1.02", letterSpacing: "-0.03em" }],
        "display-lg": ["6rem", { lineHeight: "0.98", letterSpacing: "-0.035em" }],
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
        hairline: "0 0 0 1px rgb(var(--border) / 1)",
        glow: "0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 0 0 1px rgb(var(--border) / 1)",
        "glow-primary": "0 0 50px -12px rgb(var(--cyan) / 0.5)",
        "glow-violet": "0 0 50px -12px rgb(var(--violet) / 0.55)",
        lift: "0 20px 50px -20px rgb(0 0 0 / 0.6)",
        float: "0 30px 80px -28px rgb(0 0 0 / 0.7)",
      },
      backgroundImage: {
        "gradient-primary":
          "linear-gradient(120deg, rgb(var(--cyan)) 0%, rgb(var(--violet)) 100%)",
        "gradient-primary-soft":
          "linear-gradient(120deg, rgb(var(--cyan) / 0.18) 0%, rgb(var(--violet) / 0.18) 100%)",
        "gradient-aurora":
          "radial-gradient(60% 50% at 20% 10%, rgb(var(--cyan) / 0.18) 0%, transparent 60%), radial-gradient(50% 50% at 85% 20%, rgb(var(--violet) / 0.20) 0%, transparent 60%), radial-gradient(60% 60% at 50% 100%, rgb(var(--amber) / 0.08) 0%, transparent 60%)",
        grid: "linear-gradient(rgb(var(--border) / 0.7) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border) / 0.7) 1px, transparent 1px)",
      },
      letterSpacing: {
        tightest: "-0.045em",
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
