import base from '@erp/config/eslint';

// Applies to files at the repo root only; each package has its own config.
export default [
  { ignores: ['apps/**', 'packages/**', '.data/**'] },
  ...base,
  { files: ['scripts/**'], languageOptions: { globals: { process: 'readonly' } } },
];
