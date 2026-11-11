import { defineConfig } from 'tsup';

// One self-contained file: the runtime image needs Node and nothing else.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  target: 'node22',
  platform: 'node',
  noExternal: [/.*/],
  clean: true,
  sourcemap: true,
});
