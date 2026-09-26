import type { CSSProperties } from 'react'
import { isExpertQuickLoginEnabled } from '@/shared/auth/expert-quick-login'
import { Constellation } from './Constellation'
import { DepthLayer, DepthScene } from './Depth'
import { LoginForm } from './LoginForm'
import { Logo } from '@/ui'
import styles from './login.module.css'

/**
 * Вход в систему.
 *
 * Серверный компонент: единственное, что ему нужно решить на сервере, —
 * показывать ли блок «Вход для экспертов хакатона» (решение 176, переменная
 * `EXPERT_QUICK_LOGIN`). Сама форма и её интерактивность — в `LoginForm.tsx`
 * (клиентский компонент, там же useSearchParams и вся логика `signIn`).
 */
export default function LoginPage() {
  const expertQuickLoginEnabled = isExpertQuickLoginEnabled()

  return (
    <DepthScene>
      {/* Экран входа со звёздным 3D-фоном — всегда тёмный, при любой теме (решение 122). */}
      <div className={styles.screen} data-force-dark>
        {/* 3D-созвездие за экраном; без WebGL или при «уменьшить движение» — фон как был. */}
        <Constellation />
        <section className={styles.brandSide}>
          {/* Слои левой колонки сдвигаются за курсором на разную глубину (решение 93). */}
          <DepthLayer depth={6}>
            <div className={styles.brandRow}>
              <Logo size={34} />
              <span>
                <span className={styles.brandName}>SkillLink</span>
                <span className={styles.brandSub} style={{ display: 'block' }}>
                  Вузы × IT-компании
                </span>
              </span>
            </div>
          </DepthLayer>

          <DepthLayer depth={14}>
            <h2 className={styles.headline}>Партнёрство с вузами под контролем</h2>
          </DepthLayer>
          <DepthLayer depth={10}>
            <p className={styles.lead}>
              Вузы, образовательные программы и IT-продукты в одной связке: четырнадцать этапов
              работы, честная аналитика и рекомендации с обоснованием.
            </p>
          </DepthLayer>

          {/*
            Слева — не абстрактный фон, а сама система связей (07, раздел 17):
            вуз, программа и продукт в одной связке и маршрут из четырнадцати
            этапов под ней. Линии дорисовываются при появлении, а после входа
            маршрут продолжается вправо — в рабочее пространство.
          */}
          <DepthLayer depth={22}>
            <div className={styles.map} aria-hidden="true">
              <div className={styles.mapChain}>
                <span className={styles.mapNode} style={{ '--n': 0 } as CSSProperties}>Вуз</span>
                <span className={styles.mapLink} style={{ '--n': 0 } as CSSProperties} />
                <span className={styles.mapNode} style={{ '--n': 1 } as CSSProperties}>Программа</span>
                <span className={styles.mapLink} style={{ '--n': 1 } as CSSProperties} />
                <span className={styles.mapNode} style={{ '--n': 2 } as CSSProperties}>IT-продукт</span>
              </div>
              <div className={styles.mapRail}>
                {Array.from({ length: 14 }, (_, index) => (
                  <span
                    key={index}
                    className={[styles.mapTick, index < 5 ? styles.mapTickDone : '', index === 5 ? styles.mapTickNow : '']
                      .filter(Boolean)
                      .join(' ')}
                    style={{ '--t': index } as CSSProperties}
                  />
                ))}
              </div>
              <span className={styles.mapCaption}>маршрут связки — четырнадцать этапов с контрольными точками</span>
            </div>
          </DepthLayer>
        </section>

        <section className={styles.formSide}>
          <LoginForm expertQuickLoginEnabled={expertQuickLoginEnabled} />
        </section>
      </div>
    </DepthScene>
  )
}
