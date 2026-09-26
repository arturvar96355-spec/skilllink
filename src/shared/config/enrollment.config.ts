/**
 * Набор на курсы ИТ-Школы: заказы с сайта → файл для LMS (решение 122).
 */

/** Ключ HMAC для разработки. Известен всем, кто видит код, — поэтому в продакшене запрещён. */
const DEV_ORDERS_HMAC_KEY = 'skilllink-dev-orders-hmac-key-not-for-production'

/** Короче этого ключ HMAC в продакшене не принимается: 32 знака — 256 бит в base64 с запасом. */
export const MIN_ORDERS_HMAC_KEY_LENGTH = 32

/**
 * Ключ HMAC, которым хешируются почта и телефон слушателя (`site_orders.email_hash`,
 * `phone_hash`).
 *
 * Хеш без ключа (просто SHA-256 от почты) перебирается по словарю адресов за минуты:
 * утёкшая копия базы раскрыла бы, кто учился. С ключом, который лежит вне базы
 * (переменная окружения), копия базы без него — набор случайных строк.
 *
 * В продакшене отсутствие или слишком короткий ключ — ошибка при первом обращении,
 * а не тихая работа с известным значением. Смена ключа делает старые хеши
 * несравнимыми с новыми: дубли со старыми загрузками перестанут находиться
 * (docs/PRIVACY.md) — ключ меняют только вместе с очисткой `site_orders`.
 */
export function resolveOrdersHmacKey(): string {
  const key = process.env.ORDERS_HMAC_KEY?.trim()
  if (key) {
    if (process.env.NODE_ENV === 'production' && key.length < MIN_ORDERS_HMAC_KEY_LENGTH) {
      throw new Error(
        `ORDERS_HMAC_KEY короче ${MIN_ORDERS_HMAC_KEY_LENGTH} знаков. Сгенерируйте ключ командой:\n` +
          '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      )
    }
    return key
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Не задана переменная окружения ORDERS_HMAC_KEY — без неё заказы с сайта не загружаются. ' +
        'Сгенерируйте ключ командой:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  return DEV_ORDERS_HMAC_KEY
}

/**
 * Часовой пояс даты в номере заявки сайта (ORD-ГГГГММДДЧЧММСС-…), минуты к UTC.
 * TEMP: сайт ИТ-Школы, по всей видимости, пишет московское время — подтвердить у владельца сайта.
 */
export const ORDER_NUMBER_UTC_OFFSET_MINUTES = 180 // TEMP

/** Больше заказов за одну загрузку не принимаем. */
export const MAX_SITE_ORDERS_PER_UPLOAD = 2000

/** Больше строк в файле вендоров не принимаем. */
export const MAX_VENDOR_ROWS = 2000

/**
 * Категория продукта, который загрузка вендоров заводит по названию из файла:
 * в файле вендоров категории нет, а у продукта она обязательна. Правится в карточке.
 */
export const VENDOR_IMPORT_DEFAULT_CATEGORY = 'Без категории' // TEMP

/** Имя файла для LMS: как у шаблона, с датой. */
export function lmsUsersFileName(now: Date = new Date()): string {
  return `lms-users-${now.toISOString().slice(0, 10)}.xlsx`
}
