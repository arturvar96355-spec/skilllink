/**
 * Ключ названия навыка на трудных примерах: вход → ожидаемый `skillNameKey`.
 *
 * Один набор на две проверки (решение 110): модульный тест сверяет с ним код,
 * `npm run db:verify` — выражение уникального индекса `skills_name_key_ci`
 * в базе. Разойдутся — в справочнике окажутся «дубли», которых код не видит,
 * или отказы 409, которых код не объясняет.
 */
export const SKILL_NAME_KEY_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['Machine Learning', 'machinelearning'], // обычный пробел
  ['ML Ops', 'mlops'], // пробел внутри
  ['MLOps', 'mlops'], // без пробела
  ['ml\u0009ops', 'mlops'], // табуляция
  ['Machine\u00a0Learning', 'machinelearning'], // неразрывный пробел
  ['Ideo\u3000space', 'ideospace'], // идеографический пробел
  ['bom\ufeffx', 'bomx'], // U+FEFF: в JS пробельный, в \s PostgreSQL — нет
  ['nel\u0085x', 'nel\u0085x'], // U+0085: в \s PostgreSQL с ICU пробельный, в JS — нет
  ['fs\u001cx', 'fs\u001cx'], // U+001C: то же
  ['ЁЛКА', 'ёлка'], // кириллица в верхнем регистре
  ['Е\u0308лка', 'ёлка'], // Ё из двух знаков — NFKC
  ['\uff30\uff59\uff54\uff48\uff4f\uff4e', 'python'], // полноширинные буквы — NFKC
  ['\ufb01le', 'file'], // лигатура fi — NFKC
  ['\u212aelvin', 'kelvin'], // знак Кельвина — NFKC
  ['\u0130stanbul', 'i\u0307stanbul'], // İ: полная строчная форма, два знака
  ['\u038c\u03a3\u039f\u03a3 \u0391\u03a3', '\u03cc\u03c3\u03bf\u03c2\u03b1\u03c2'], // Σ в конце слова: строчная до удаления пробелов
  ['C++', 'c++'], // знаки не трогаются
  ['C#', 'c#'], // знаки не трогаются
]
