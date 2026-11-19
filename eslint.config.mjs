// Flat config for all non-web workspaces (web uses eslint-config-next).
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/convex/_generated/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'prefer-const': 'off',
    },
  }
);
