/**
 * Знак SkillLink.
 *
 * Связь двух точек — вуз и продукт — сам по себе, без квадрата-подложки
 * и градиентной обводки (07, разделы 3 и 5: градиент на контуре логотипа
 * и значок в скруглённом квадрате — главные приметы шаблона). Одна точка —
 * светлая, вторая — фирменный фиолетовый: связь, у которой есть направление.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M9 22 23 10" stroke="#a8a6af" strokeWidth="2" strokeLinecap="round" />
      <circle cx="9" cy="22" r="4.5" fill="#f3f1ed" />
      <circle cx="23" cy="10" r="4.5" fill="#8e6cff" />
    </svg>
  )
}
