import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Set PAGES_BASE=/collaborative_game/ only in the Pages deploy workflow.
  base: process.env.PAGES_BASE || "/",
  plugins: [tailwindcss()],
});
