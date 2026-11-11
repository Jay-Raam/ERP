export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'repo',
        'ci',
        'api',
        'web',
        'shared',
        'config',
        'auth',
        'org',
        'branch',
        'employee',
        'rbac',
        'accounts',
        'attendance',
        'payroll',
        'sale',
        'store',
        'purchase',
        'report',
      ],
    ],
  },
};
