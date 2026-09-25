import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import type { ReactNode } from 'react'
import { Providers } from './providers'
import { SPLASH_BOOT_SCRIPT, Splash } from '@/ui/layout/Splash'
import { UI_MODE_BOOT_SCRIPT } from '@/ui/lib/ui-mode'
import { THEME_BOOT_SCRIPT } from '@/ui/lib/theme'
import './globals.css'

/**
 * Inter с кириллицей.
 *
 * Шрифт скачивается на сборке и кладётся рядом с приложением: в браузере
 * пользователя запроса к чужому серверу не будет. Для показа это важно —
 * стенд не должен зависеть от того, открывается ли гугловский домен.
 */
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'SkillLink',
  description: 'Система контроля взаимодействия с учебными заведениями',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0b10',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: скрипты до загрузки приложения ставят на <html>
    // метки data-mode (режим интерфейса) и data-splash — их в серверной разметке
    // нет, и это нормально.
    <html lang="ru" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* Режим — первым: от него зависят заставка и стили рабочего режима (решение 80). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: UI_MODE_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT_SCRIPT }} />
        <Splash />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
