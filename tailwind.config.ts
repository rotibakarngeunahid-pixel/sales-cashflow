import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        app: {
          surface: "#F6F7FB",
        },
        rbn: {
          red: "#DC2626",
          "red-dark": "#B91C1C",
          "red-light": "#FEF2F2",
          orange: "#EA580C",
          "orange-light": "#FFF7ED",
          yellow: "#D97706",
          "yellow-light": "#FFFBEB",
          white: "#FFFFFF",
        },
      },
      fontFamily: {
        sans: ["Inter", "Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
