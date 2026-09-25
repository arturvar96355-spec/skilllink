import type { MetadataRoute } from 'next'

/**
 * Манифест веб-приложения: название и значки для плиток браузера, закладок
 * и «Добавить на экран „Домой“». Без него Chrome рисовал вместо значка серую
 * букву «S». Значки — знак SkillLink на тёмном фоне интерфейса.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SkillLink — партнёрство с вузами',
    short_name: 'SkillLink',
    description: 'Система контроля взаимодействия с учебными заведениями',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0b10',
    theme_color: '#0b0b10',
    lang: 'ru',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
