import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
//import { metaImagesPlugin } from "../vite-plugin-meta-images";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    //metaImagesPlugin(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared"),
      "@assets": "/attached_assets",
    },
  },

  build: {
    outDir: "dist",
  },

  server: {
    host: "0.0.0.0",
  },
});