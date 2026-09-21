import { z } from 'zod'
import { ru } from 'zod/locales'

/**
 * Тексты ошибок валидации на русском (требование контракта API в CLAUDE.md).
 * Вызывается один раз при загрузке модуля; импортируется всюду, где нужен z.
 */
z.config(ru())

export { z }
