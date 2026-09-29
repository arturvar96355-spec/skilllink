import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * «Когорты» скрыты из «Аналитики» (решение 229), а затем удалены целиком — экран,
 * расчёт и API (решение 239). Документы для жюри и пользователя не должны звать
 * во вкладку, которой нет.
 */

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('удалённая вкладка «Когорты» не обещана в документах', () => {
  it('вкладки cohorts нет в TABS страницы аналитики', () => {
    expect(read('src/app/(app)/analytics/page.tsx')).not.toMatch(/key:\s*'cohorts'/)
  })

  it.each(['docs/TZ_COMPLIANCE.md', 'docs/USER_GUIDE.md', 'README.md'])('%s не называет «Когорты» вкладкой', (path) => {
    expect(read(path)).not.toMatch(/«Когорты»/)
  })
})
