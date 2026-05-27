import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

function resolveReleaseDate(): string {
  // Date of the git tag commit matching frontend's package.json version
  // (the release tag, NOT the build time). Empty string if the tag is missing.
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
    ) as { version?: string };
    if (!pkg.version) return '';
    const tag = `v${pkg.version}`;
    const out = execSync(`git log -1 --format=%cI ${tag}`, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim();
  } catch {
    return '';
  }
}

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
    define: {
      // ISO date string of the git tag commit for this version (the release
      // date, not the build date). Empty if the tag is missing.
      __RELEASE_DATE__: JSON.stringify(resolveReleaseDate()),
    },
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
