// Web app lint: TypeScript-aware, no type-checked rules (fast CI).
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/.next/**', '**/node_modules/**', '**/convex-api.ts'],
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.{ts,tsx}'] })),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  }
);
