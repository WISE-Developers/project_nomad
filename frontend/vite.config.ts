import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env from project root (parent directory)
  const envDir = path.resolve(__dirname, '..');
  const env = loadEnv(mode, envDir, '');

  // Get ports from environment with sensible defaults
  const devPort = parseInt(env.VITE_DEV_PORT || '5173', 10);
  const apiPort = env.VITE_API_PORT || '3001';
  const apiTarget = `http://localhost:${apiPort}`;

  return {
    plugins: [react()],
    envDir,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: devPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
