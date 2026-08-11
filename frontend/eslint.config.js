import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Hardcoded colors are the drift class this app is most prone to: a hex
      // that looks right on whichever of the 8 theme presets you had open, and
      // is unreadable on the other 7. See docs/DESIGN_SYSTEM.md "golden rule"
      // and ADR 0035 for two real bugs of exactly this shape.
      //
      // A string containing `var(--` is allowed: it is token-first, and any hex
      // in it is a fallback rather than the actual answer. Everything else with
      // a hex in it is flagged.
      //
      // Legitimate exceptions exist (see the table in DESIGN_SYSTEM.md). Silence
      // them at the site with an eslint-disable-next-line AND a reason, so the
      // exception is visible in the code rather than buried in a config.
      // NOTE: 'warn', not 'error', on purpose. There are ~38 pre-existing
      // violations. Landing this as an error would break `npm run lint` for
      // everyone and the realistic response would be a blanket disable, which
      // is worse than no rule. It warns now so NEW hardcoded colors are visible
      // in review, and gets promoted to 'error' once the count reaches zero.
      // Progress is tracked in docs/INCREMENTAL_WORK.md item 7.
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'Literal[value=/^(?!.*var\\(--).*#[0-9a-fA-F]{3,8}\\b/]',
          message:
            'Hardcoded color. Use a theme var (docs/DESIGN_SYSTEM.md). For ink on a filled surface use --on-brand / --on-ok, never a literal. If this is a genuine exception, disable with a reason.',
        },
        {
          selector: 'TemplateElement[value.raw=/^(?!.*var\\(--).*#[0-9a-fA-F]{3,8}\\b/]',
          message:
            'Hardcoded color in a template literal. Use a theme var (docs/DESIGN_SYSTEM.md). If this is a genuine exception, disable with a reason.',
        },
      ],
    },
  },
  {
    // Permanent exceptions, off at config level because they will never be
    // "cleaned up" and should not sit in the warning count forever. Anything
    // else needs a per-site disable with a reason. See the exceptions table in
    // docs/DESIGN_SYSTEM.md.
    files: [
      // The palettes are DEFINED here. Every preset value is a hex by definition.
      'src/theme/ThemeContext.tsx',
      // Must render when theming has failed, so it cannot depend on theme vars.
      'src/components/ErrorBoundary.tsx',
      // PWA manifest theme_color / background_color are build-time literals in
      // the installed-app chrome. They are not runtime-themed surfaces.
      'vite.config.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
])
