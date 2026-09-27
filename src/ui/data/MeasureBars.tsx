'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { useCalmMotion } from '../hooks/ui-mode'
import { Icon } from '../primitives/Icon'
import { measureShare } from './measure-bars'
import styles from './MeasureBars.module.css'

/**
 * Горизонтальные полосы — основная форма диаграмм аналитики (решение 215, правила
 * единого языка диаграмм):
 *
 * - плоско: полоса без объёма и свечения, одно движение — дорастает до значения один раз;
 * - цвет — сигнал: фиолетовый — основное, жёлтый — «ниже цели», красный — «требует
 *   внимания»; шаги одного процесса — светлотой одного тона (`shade`), а не разными цветами;
 * - число подписано у полосы всегда, без наведения (`valueText`, колонка сразу за шкалой —
 *   так подпись не ложится на отметку нормы и на хвост шкалы);
 * - рядом с числом — с чем сравнить: отметка нормы или цели на шкале (`marker`) и
 *   отклонение словами (`note`);
 * - остаток списка назван строкой (`rest`: «и ещё 9 вузов»).
 *
 * Шкала общая для всех строк: `max` — правый край. Строка может начинаться с перехода
 * от предыдущей (`between`: «75 % перешли дальше») — так воронка остаётся полосами.
 */

export type MeasureTone = 'default' | 'warning' | 'danger' | 'muted'

export interface MeasureBarRow {
  key: string
  label: string
  /** Вторая строка под названием: вуз, категория, номер этапа. */
  caption?: string
  href?: string
  /** Длина полосы в единицах шкалы. null — «Нет данных»: полосы нет, число не подменяется нулём. */
  value: number | null
  /** Подпись на конце полосы — число с единицей: «38 из 77», «16 дн.». */
  valueText: string
  /** Отметка нормы или цели на той же шкале. */
  marker?: number | null
  tone?: MeasureTone
  /** Ступень светлоты основного тона 0–4 — порядок шагов одного процесса. */
  shade?: number
  /** Сравнение словами: «на 2 дня дольше нормы», «×3,1 к медиане». */
  note?: string
  noteTone?: MeasureTone
  /** Строка перехода над этой строкой — для воронки. */
  between?: { text: string; tone?: MeasureTone }
}

export function MeasureBars({
  rows,
  max,
  label,
  markerLabel,
  rest,
  valueWidth = '7rem',
  labelWidth = '14rem',
}: {
  rows: MeasureBarRow[]
  /** Правый край шкалы. */
  max: number
  /** Что показывает диаграмма — для программ чтения с экрана. */
  label: string
  /** Что значит отметка на шкале: «норма», «медиана», «спрос рынка». Показывается легендой. */
  markerLabel?: string
  /** Остаток списка словами: «и ещё 9 навыков — в таблице ниже». */
  rest?: string
  /** Ширина колонки с подписью числа — сразу справа от шкалы. */
  valueWidth?: string
  /** Ширина колонки названий на широком экране. */
  labelWidth?: string
}) {
  const calm = useCalmMotion()
  const hasMarker = rows.some((row) => row.marker !== undefined && row.marker !== null)
  const hasNotes = rows.some((row) => row.note !== undefined)

  return (
    <figure
      className={styles.root}
      aria-label={label}
      data-calm={calm || undefined}
      data-notes={hasNotes || undefined}
      style={{ '--mb-reserve': valueWidth, '--mb-label': labelWidth } as CSSProperties}
    >
      <ol className={styles.list}>
        {rows.map((row, index) => {
          const share = measureShare(row.value, max)
          const markerShare = row.marker === undefined || row.marker === null ? null : measureShare(row.marker, max)
          return (
            <li key={row.key} className={styles.item}>
              {row.between && (
                <p className={styles.between} data-tone={row.between.tone ?? 'default'}>
                  <Icon name="chevronDown" size={16} />
                  {row.between.text}
                </p>
              )}
              <div className={styles.row}>
                <span className={styles.head}>
                  {row.href ? (
                    <Link className={styles.link} href={row.href}>
                      {row.label}
                    </Link>
                  ) : (
                    <span className={styles.label}>{row.label}</span>
                  )}
                  {row.caption && <span className={styles.caption}>{row.caption}</span>}
                </span>
                <span
                  className={styles.track}
                  style={
                    {
                      '--p': share ?? 0,
                      '--m': markerShare ?? 0,
                      '--i': index,
                    } as CSSProperties
                  }
                >
                  {share !== null && (
                    <span
                      className={styles.fill}
                      data-tone={row.tone ?? 'default'}
                      data-shade={row.shade ?? undefined}
                    />
                  )}
                  {markerShare !== null && <span className={styles.marker} aria-hidden />}
                </span>
                <span className={styles.value} data-empty={share === null || undefined} style={{ '--i': index } as CSSProperties}>
                  {row.valueText}
                </span>
                {hasNotes && (
                  <span className={styles.note} data-tone={row.noteTone ?? 'default'}>
                    {row.note}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {(rest || (hasMarker && markerLabel)) && (
        <figcaption className={styles.foot}>
          {rest && <span>{rest}</span>}
          {hasMarker && markerLabel && (
            <span className={styles.legend}>
              <span className={styles.legendMarker} aria-hidden />
              {markerLabel}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  )
}
