import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import path from 'path';

/**
 * Library build configuration for openNomad module.
 *
 * This builds the embeddable component and API for ACN (Agency Centric Nomad) mode.
 * Agencies install @nomad/frontend and import the openNomad module to integrate
 * fire modeling capabilities into their existing systems.
 *
 * Usage:
 *   npm run build:lib
 *
 * Output:
 *   dist/
 *     openNomad.js       - ES module bundle
 *     openNomad.d.ts     - TypeScript declarations (rolled up)
 */
export default defineConfig({
  plugins: [
    react(),
    dts({
      // Generate .d.ts files - include openNomad + Dashboard + ModelSetup (Dashboard depends on it)
      include: [
        'src/openNomad/**/*.ts',
        'src/openNomad/**/*.tsx',
        'src/features/Dashboard/**/*.ts',
        'src/features/Dashboard/**/*.tsx',
        'src/features/ModelSetup/**/*.ts',
        'src/features/ModelSetup/**/*.tsx',
        'src/features/Wizard/**/*.ts',
        'src/features/Wizard/**/*.tsx',
      ],
      // Exclude test files
      exclude: ['**/*.test.ts', '**/*.test.tsx'],
      // Roll up declarations into a single file
      rollupTypes: true,
      // Output to dist/
      outDir: 'dist',
      // Entry point for type declarations
      entryRoot: 'src',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    lib: {
      // Entry point for the library
      entry: path.resolve(__dirname, 'src/openNomad/index.ts'),
      // Global name for UMD builds (not used, but required)
      name: 'openNomad',
      // ES module for modern bundlers, UMD for script tag usage
      formats: ['es', 'umd'],
      // Output filename
      fileName: 'openNomad',
    },
    rollupOptions: {
      // Externalize peer dependencies - consumers must provide these
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'mapbox-gl',
        '@mapbox/mapbox-gl-draw',
        '@turf/turf',
      ],
      output: {
        // Preserve module structure for better tree-shaking
        preserveModules: false,
        // Global variable names for externals (UMD only, but good practice)
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          'mapbox-gl': 'mapboxgl',
          '@mapbox/mapbox-gl-draw': 'MapboxDraw',
          '@turf/turf': 'turf',
        },
      },
    },
    // Output to dist/ folder
    outDir: 'dist',
    // Don't empty outDir (allows multiple builds)
    emptyOutDir: true,
    // Generate sourcemaps for debugging
    sourcemap: true,
    // Minify for production
    minify: 'esbuild',
  },
  // Don't copy public folder assets for library build
  publicDir: false,
});
