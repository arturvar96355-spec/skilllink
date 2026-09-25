import { FlatCompat } from '@eslint/eslintrc'

/**
 * ESLint в щадящем режиме (решение 113).
 *
 * Основа — наборы Next 15: `next/core-web-vitals` (React, хуки, правила Next,
 * доступность) и `next/typescript` (рекомендованные правила typescript-eslint).
 * eslint-config-next 15 выпущен в старом формате, поэтому подключается через
 * FlatCompat — так предписывает документация Next 15.
 *
 * Уровень «error» — только у правил, которые ловят настоящие ошибки: нарушенный
 * порядок хуков, список без key, пропавшие в React 19 API, падение на `?.` с `!`.
 * Правила вкуса и стиля понижены до «warn»: CI на них не падает, число предупреждений
 * видно в сводке прогона, чистка — отдельными задачами.
 */
const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

/** Правила из наборов Next, которые по умолчанию «error», но ошибок в коде не ловят. */
const STYLE_RULES_AS_WARNINGS = [
  // JavaScript
  'no-var',
  'prefer-const',
  'prefer-rest-params',
  'prefer-spread',
  // React
  'react/display-name',
  'react/no-children-prop',
  'react/no-unescaped-entities',
  // Next: оптимизации для каталога pages/, в App Router ошибкой не являются
  '@next/next/no-html-link-for-pages',
  '@next/next/no-sync-scripts',
  // TypeScript
  '@typescript-eslint/ban-ts-comment',
  '@typescript-eslint/no-array-constructor',
  '@typescript-eslint/no-empty-object-type',
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-extra-non-null-assertion',
  '@typescript-eslint/no-namespace',
  '@typescript-eslint/no-require-imports',
  '@typescript-eslint/no-this-alias',
  '@typescript-eslint/no-unnecessary-type-constraint',
  '@typescript-eslint/no-unsafe-function-type',
  '@typescript-eslint/no-wrapper-object-types',
  '@typescript-eslint/prefer-as-const',
  '@typescript-eslint/prefer-namespace-keyword',
  '@typescript-eslint/triple-slash-reference',
]

const config = [
  {
    // Клиент Prisma генерируется, сборка и зависимости — не наш код, в public — только статика.
    ignores: ['src/generated/**', '.next/**', 'node_modules/**', 'public/**', 'next-env.d.ts'],
  },
  ...compat.config({ extends: ['next/core-web-vitals', 'next/typescript'] }),
  {
    rules: {
      ...Object.fromEntries(STYLE_RULES_AS_WARNINGS.map((rule) => [rule, 'warn'])),
      // Как у tsc с noUnusedLocals: имя с подчёркиванием — намеренно не используется
      // (например, поле, выброшенное из объекта деструктуризацией).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
]

export default config
