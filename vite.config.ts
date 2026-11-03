import { defineConfig } from 'vite';
import { copyFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';

const findHtmlPages = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-server' || entry.name === '.git' || entry.name === 'public') return [];
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return findHtmlPages(entryPath);
    return extname(entry.name) === '.html' ? [entryPath] : [];
  });

const htmlInputs = Object.fromEntries(findHtmlPages(process.cwd()).map((file) => [
  relative(process.cwd(), file).replace(/\.html$/, '').split(sep).join('/'),
  file
]));

const copySharedNavigation = {
  name: 'copy-shared-navigation',
  apply: 'build' as const,
  closeBundle() {
    copyFileSync(resolve(process.cwd(), 'shared-nav.js'), resolve(process.cwd(), 'dist', 'shared-nav.js'));
  }
};

export default defineConfig({
  root: '.',
  plugins: [copySharedNavigation],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: htmlInputs },
  },
});
