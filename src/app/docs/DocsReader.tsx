import type { ReactNode } from 'react'
import { HELP_SECTION_GROUPS } from '@/shared/help'
import { DocsArticle } from './DocsArticle'
import { DocsNav, type DocsTocGroup } from './DocsNav'
import styles from './docs.module.css'

/** Оглавление — только заголовки и якоря: в браузер уходит несколько килобайт, а не весь текст. */
const TOC: DocsTocGroup[] = HELP_SECTION_GROUPS.map((group) => ({
  id: group.id,
  title: group.title,
  sections: group.sections.map((section) => ({ id: section.id, title: section.title })),
}))

/**
 * Документация целиком — оглавление с поиском слева и текст справа (решение 214).
 * Одна и та же на `/docs` (без входа) и на `/help` (внутри системы): `variant`
 * меняет только отступ под шапку и место кнопки «Наверх».
 */
export function DocsReader({ variant, intro }: { variant: 'public' | 'app'; intro?: ReactNode }) {
  return (
    <div className={styles.reader} data-variant={variant}>
      <DocsNav toc={TOC} variant={variant} />
      <div id="docs-article" className={styles.article}>
        {intro}
        <div id="docs-search-status" className={styles.statusSlot} />
        <DocsArticle />
      </div>
    </div>
  )
}
