import styles from './Logo.module.css'

/**
 * Знак SkillLink.
 *
 * Связь двух точек — вуз и продукт — сам по себе, без квадрата-подложки
 * и градиентной обводки (07, разделы 3 и 5: градиент на контуре логотипа
 * и значок в скруглённом квадрате — главные приметы шаблона). Одна точка —
 * светлая, вторая — фирменный фиолетовый: связь, у которой есть направление.
 *
 * Цвета — токенами: в светлой теме «светлая» точка становится тёмной (решение 122).
 * `interactive` — знак в ссылке: при наведении на неё точки чуть расходятся,
 * связь вспыхивает фирменным цветом, фиолетовая точка светится (бриф v2, 2.2).
 */
export function Logo({ size = 28, interactive = false }: { size?: number; interactive?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={interactive ? `${styles.mark} ${styles.interactive}` : styles.mark}
    >
      <path className={styles.link} d="M9 22 23 10" strokeWidth="2" strokeLinecap="round" />
      <circle className={styles.from} cx="9" cy="22" r="4.5" />
      <circle className={styles.to} cx="23" cy="10" r="4.5" />
    </svg>
  )
}
