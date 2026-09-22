/**
 * Знак SkillLink.
 *
 * Две связанные точки — вуз и продукт — на фирменном градиенте. Рисуется
 * разметкой, а не картинкой: не нужен отдельный файл, знак масштабируется
 * без размытия и красится теми же переменными, что и остальной интерфейс.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="skilllink-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF4FB3" />
          <stop offset="0.48" stopColor="#C84DFF" />
          <stop offset="1" stopColor="#FF7A45" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="9.25" fill="#1A1230" stroke="url(#skilllink-mark)" strokeWidth="1.5" />
      <path d="M10.5 20.5 21.5 11.5" stroke="url(#skilllink-mark)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10.5" cy="20.5" r="3.4" fill="#1A1230" stroke="url(#skilllink-mark)" strokeWidth="2" />
      <circle cx="21.5" cy="11.5" r="3.4" fill="#1A1230" stroke="url(#skilllink-mark)" strokeWidth="2" />
    </svg>
  )
}
