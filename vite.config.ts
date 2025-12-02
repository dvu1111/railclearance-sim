import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // You can remove the env loader if you don't have other env vars
    return {
      // REQUIRED: Matches your repository name for GitHub Pages in production
      // Uses root path for local development
      base: mode === 'production' ? '/railclearance-sim/' : '/', 
      
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // REMOVED: The 'define' block for API keys is no longer needed
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});