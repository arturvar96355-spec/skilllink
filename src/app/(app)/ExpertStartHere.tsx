'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CooperationListItemDto } from '@/shared/contracts'
import { Button, ROUTES, Section, cooperationHref, useResource } from '@/ui'
import styles from './dashboard.module.css'

/** Ключ в localStorage — свёрнут ли маршрут эксперта на этом устройстве. */
const STORAGE_KEY = 'skilllink.expertStartHereCollapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // приватное окно или запрет хранилища — свёрнутость просто не запомнится
  }
}

/**
 * «С чего начать» — маршрут эксперта хакатона (итог ресерча 26.09, п. 2.1):
 * за пять минут показать ядро системы, а не всю «витрину». Пять шагов —
 * рекомендации, живая связка, её контрольная точка, отчёт за период
 * и кабинет представителя вуза.
 *
 * Виден только эксперту (`user.isReviewer`, решение 176) прямо на главной —
 * обычным сотрудникам такой блок только мешал бы. Свёрнутость запоминается
 * в браузере, чтобы не мозолить глаза при каждом заходе.
 */
export function ExpertStartHere() {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => setCollapsed(readCollapsed()), [])

  // Демонстрационная связка СПбГУТ — «Программная инженерия»: у неё сейчас
  // просрочен этап 6 (контрольная точка, docs/CONTROL_POINTS.md) — на ней
  // видно и работу с просрочкой, и отказ системы перескочить контроль.
  // Найдено по данным, а не зашито id: демо-данные могут быть перезалиты.
  const found = useResource<CooperationListItemDto[]>(
    collapsed ? null : `/api/cooperations?q=${encodeURIComponent('Программная инженерия')}&pageSize=20`,
  )
  const demo = found.data?.find(
    (item) => item.universityShortName === 'СПбГУТ' && item.programName === 'Программная инженерия',
  )
  const demoHref = demo
    ? cooperationHref(demo.id, demo.currentStage?.stageNumber === 6 ? demo.currentStage.id : undefined)
    : ROUTES.cooperations

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      writeCollapsed(next)
      return next
    })
  }

  return (
    <Section
      title="С чего начать"
      help={{ topic: 'expert-start' }}
      description="Маршрут по ядру системы на пять минут — для эксперта хакатона."
      action={
        <Button variant="secondary" size="sm" onClick={toggle} aria-expanded={!collapsed}>
          {collapsed ? 'Показать' : 'Свернуть'}
        </Button>
      }
    >
      {!collapsed && (
        <ol className={styles.expertStart}>
          <li className={styles.expertStep}>
            <span className={styles.expertStepNo}>1</span>
            <span className={styles.expertStepText}>
              <Link href={ROUTES.recommendations}>Список задач</Link> — что система предлагает сделать
              и почему каждая задача появилась.
            </span>
          </li>
          <li className={styles.expertStep}>
            <span className={styles.expertStepNo}>2</span>
            <span className={styles.expertStepText}>
              <Link href={demoHref}>Связка СПбГУТ — «Программная инженерия»</Link> — вуз, программа и IT-продукт
              на одном экране, этапы и история.
            </span>
          </li>
          <li className={styles.expertStep}>
            <span className={styles.expertStepNo}>3</span>
            <span className={styles.expertStepText}>
              <Link href={demoHref}>Контрольная точка этой связки (этап 6)</Link> — что система разрешает
              и что запрещает раньше срока.
            </span>
          </li>
          <li className={styles.expertStep}>
            <span className={styles.expertStepNo}>4</span>
            <span className={styles.expertStepText}>
              <Link href={ROUTES.tzReport}>Отчёт по связкам за период</Link> — с фильтрами по вузу, направлению,
              продукту и ответственному.
            </span>
          </li>
          <li className={styles.expertStep}>
            <span className={styles.expertStepNo}>5</span>
            <span className={styles.expertStepText}>
              Кабинет представителя вуза — выйдите и войдите кнопкой «Представитель вуза» на{' '}
              <Link href={ROUTES.login}>странице входа</Link>.
            </span>
          </li>
        </ol>
      )}
    </Section>
  )
}
