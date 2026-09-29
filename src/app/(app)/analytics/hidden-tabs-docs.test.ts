import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Вкладка «Когорты» скрыта из «Аналитики» (решение 229), а таблица соответствия
 * ТЗ ещё обещала в ней кнопку «PNG» (ревью 29.09, P1-1). Пока вкладки нет в
 * `TABS`, документы для жюри и пользователя не должны звать в неё.
 */

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('скрытая вкладка «Когорты» не обещана в документах', () => {
  it('вкладки cohorts нет в TABS страницы аналитики', () => {
    expect(read('src/app/(app)/analytics/page.tsx')).not.toMatch(/key:\s*'cohorts'/)
  })

  it.each(['docs/TZ_COMPLIANCE.md', 'docs/USER_GUIDE.md', 'README.md'])('%s не называет «Когорты» вкладкой', (path) => {
    expect(read(path)).not.toMatch(/«Когорты»/)
  })
})
