import base from '@erp/config/eslint';

export default [
  ...base,
  {
    // SQL lives in repositories and src/db only. Services and resolvers never build queries.
    files: ['src/**/*.ts'],
    ignores: ['src/db/**', 'src/**/repository.ts', 'src/**/*.repository.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'postgres', message: 'Use the database handle from src/db.' },
            {
              name: 'drizzle-orm',
              importNames: ['sql'],
              message: 'Raw SQL is only allowed in repositories and src/db.',
            },
          ],
          patterns: [
            {
              group: ['**/db/schema', '**/db/schema/*'],
              message: 'Query tables from a repository.',
            },
          ],
        },
      ],
    },
  },
];
