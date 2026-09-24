/**
 * Логотипы вузов для бирок реестра (решение 77) — файлы в `public/logos/`.
 *
 * TEMP: до поля «логотип» у вуза в базе (задача для Тиграна и Артура после
 * защиты). Пока логотипы есть у шести вузов демо-набора, сопоставление — по
 * сокращённому названию. Вуза нет в списке — на бирке остаётся сокращение.
 *
 * Источники: официальные сайты вузов (sut.ru, mtuci.ru, kai.ru, nstu.ru,
 * donstu.ru) и Викисклад для УрФУ (символ в общественном достоянии).
 */
export interface UniversityLogo {
  src: string
  /** Подложка: светлая для цветных логотипов, тёмная — для белого (СПбГУТ). */
  plate: 'light' | 'dark'
}

const LOGOS: Record<string, UniversityLogo> = {
  'СПбГУТ': { src: '/logos/sut.svg', plate: 'dark' },
  'МТУСИ': { src: '/logos/mtuci.svg', plate: 'light' },
  'КНИТУ-КАИ': { src: '/logos/kai.png', plate: 'light' },
  'НГТУ': { src: '/logos/nstu.png', plate: 'light' },
  'УрФУ': { src: '/logos/urfu.jpg', plate: 'light' },
  'ДГТУ': { src: '/logos/donstu.png', plate: 'light' },
}

export function logoFor(shortName: string | null): UniversityLogo | null {
  return (shortName && LOGOS[shortName]) || null
}
