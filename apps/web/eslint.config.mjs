import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'next-env.d.ts', 'coverage/**'] },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'no-console': 'error',
      // Raw HTML must go through the sanitiser; see docs in the plan (XSS control).
      'react/no-danger': 'error',
    },
  },
];

export default config;
