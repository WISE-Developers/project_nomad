import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
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

  // Source-map upload to Sentry (#313, S3). DORMANT unless SENTRY_AUTH_TOKEN is
  // present. The token is a write secret that lives ONLY in CIFFC's CI/build
  // env — never in a casual user's local build — so a local install builds
  // normally with no upload (and thus keeps minified traces). CIFFC's CI build
  // (with the token + SENTRY_ORG + SENTRY_PROJECT) uploads maps for readable
  // stack traces on the centrally-built/hosted release.
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN;
  const pkgVersion = (
    JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
      version?: string;
    }
  ).version;
  const sentryRelease = env.VITE_SENTRY_RELEASE || (pkgVersion ? `nomad@${pkgVersion}` : undefined);

  const plugins = [react()];
  if (sentryAuthToken) {
    plugins.push(
      sentryVitePlugin({
        authToken: sentryAuthToken,
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        release: sentryRelease ? { name: sentryRelease } : undefined,
        telemetry: false,
        // Never fail the build over telemetry upload — warn and continue.
        errorHandler: (err) => console.warn('[sentry-vite-plugin]', err.message),
      }),
    );
  }

  return {
    plugins,
    // Generate hidden source maps only when uploading: 'hidden' keeps the
    // //# sourceMappingURL out of the bundle so maps are never served to users
    // (the plugin uploads them to Sentry, then deletes them from the output).
    build: { sourcemap: sentryAuthToken ? 'hidden' : false },
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
