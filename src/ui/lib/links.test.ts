import { describe, expect, it } from 'vitest'
import { githubHeadingAnchor, repoDocHref } from './links'

describe('ссылки на разделы документов в репозитории (решение 235)', () => {
  it('якорь заголовка — как у GitHub: строчные, без знаков, пробел — дефис', () => {
    expect(githubHeadingAnchor('1. Рейтинг образовательной программы')).toBe('1-рейтинг-образовательной-программы')
    expect(githubHeadingAnchor('3. Дефицит навыка (skill gap)')).toBe('3-дефицит-навыка-skill-gap')
    expect(githubHeadingAnchor('3а. Профиль программы для дефицитов')).toBe('3а-профиль-программы-для-дефицитов')
  })

  it('ссылка ведёт в открытый репозиторий, без раздела — на документ целиком', () => {
    expect(repoDocHref('docs/PRIVACY.md', '5. Сроки хранения и уничтожение')).toBe(
      'https://github.com/arturvar96355-spec/skilllink/blob/main/docs/PRIVACY.md#5-сроки-хранения-и-уничтожение',
    )
    expect(repoDocHref('docs/PRIVACY.md')).toBe('https://github.com/arturvar96355-spec/skilllink/blob/main/docs/PRIVACY.md')
  })
})
