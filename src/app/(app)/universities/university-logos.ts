/**
 * Логотипы вузов для бирок реестра (решение 77, добавление — решение 237) —
 * файлы в `public/logos/`.
 *
 * TEMP: до поля «логотип» у вуза в базе (задача для Тиграна и Артура после
 * защиты). Логотипы есть у 19 из 19 вузов демо-набора, сопоставление — по
 * сокращённому названию. Вуза нет в списке — на бирке остаётся сокращение.
 *
 * Источники (решение 77): официальные сайты вузов (sut.ru, mtuci.ru, kai.ru,
 * nstu.ru, donstu.ru) и Викисклад для УрФУ (символ в общественном достоянии).
 *
 * Источники (решение 237, 13 вузов): официальные сайты — vsu.ru (ВГУ),
 * dvfu.ru (ДВФУ), kubstu.ru (КубГТУ), sfu.ru (СФУ, домен sfu-kras.ru ведёт
 * туда же); Викисклад (файл — карточка Wikidata, свойство «логотип», P154) —
 * commons.wikimedia.org/wiki/File:Logo_round_INRTU.jpg (ИРНИТУ),
 * .../File:IU_logo.svg (Иннополис), .../File:Logo_UNN_white_rus4.svg (ННГУ),
 * .../File:Логотип_Омского_государственного_технического_университета.png
 * (ОмГТУ), .../File:Psuti_logo_main_cs3.svg (ПГУТИ), .../File:Логотип+
 * ПНИПУfile.png (ПНИПУ), .../File:TUSUR_logo.png (ТУСУР), .../File:Uustt.png
 * (УУНиТ). БФУ — не Викисклад: favicon-32x32.png с kantiana.ru (их же
 * фирменный знак — круглая монограмма «БФУ», при уменьшении читается лучше
 * полного горизонтального логотипа с Викисклада).
 *
 * Квадратные бирки (решение 237, правка после ревью): в квадратной плашке
 * 36 px горизонтальный логотип с длинным текстом схлопывается в нечитаемую
 * полоску (`object-fit: contain` вписывает по ширине, высота остаётся
 * буквально в несколько пикселей). Для БФУ, ДВФУ, ННГУ и заодно старого
 * МТУСИ (тот же дефект, решение 77) — не полный логотип, а только знак:
 * БФУ — favicon-32x32.png (готовый квадратный знак, см. выше); ДВФУ и
 * СФУ (тоже был широким) — `viewBox` файла с сайта обрезан до пиктограммы
 * (волна ДВФУ, узел СФУ), слова обрезаны; ННГУ — `viewBox` файла с
 * Викисклада обрезан до синей плашки со щитом (сама плашка непрозрачная —
 * подложка компонента всё равно не видна); МТУСИ — `viewBox` старого файла
 * обрезан до семиугольника. Файлы и веса те же (не считая БФУ, где место
 * SVG занял PNG-значок), просто больше не видна часть с текстом.
 */
export interface UniversityLogo {
  src: string
  /** Подложка: светлая для цветных логотипов, тёмная — для белого (СПбГУТ, КубГТУ). */
  plate: 'light' | 'dark'
}

const LOGOS: Record<string, UniversityLogo> = {
  'СПбГУТ': { src: '/logos/sut.svg', plate: 'dark' },
  'МТУСИ': { src: '/logos/mtuci.svg', plate: 'light' },
  'КНИТУ-КАИ': { src: '/logos/kai.png', plate: 'light' },
  'НГТУ': { src: '/logos/nstu.png', plate: 'light' },
  'УрФУ': { src: '/logos/urfu.jpg', plate: 'light' },
  'ДГТУ': { src: '/logos/donstu.png', plate: 'light' },
  'БФУ им. И. Канта': { src: '/logos/kantiana.png', plate: 'light' },
  'ВГУ': { src: '/logos/vsu.png', plate: 'light' },
  'ДВФУ': { src: '/logos/dvfu.svg', plate: 'light' },
  'ИРНИТУ': { src: '/logos/istu.png', plate: 'light' },
  'Иннополис': { src: '/logos/innopolis.svg', plate: 'light' },
  'КубГТУ': { src: '/logos/kubstu.png', plate: 'dark' },
  'ННГУ': { src: '/logos/unn.svg', plate: 'light' },
  'ОмГТУ': { src: '/logos/omgtu.png', plate: 'light' },
  'ПГУТИ': { src: '/logos/psuti.svg', plate: 'light' },
  'ПНИПУ': { src: '/logos/pstu.png', plate: 'light' },
  'СФУ': { src: '/logos/sfu.svg', plate: 'light' },
  'ТУСУР': { src: '/logos/tusur.png', plate: 'light' },
  'УУНиТ': { src: '/logos/uust.png', plate: 'light' },
}

export function logoFor(shortName: string | null): UniversityLogo | null {
  return (shortName && LOGOS[shortName]) || null
}
