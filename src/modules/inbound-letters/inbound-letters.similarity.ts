/**
 * Похожие прошлые письма — простой поиск без внешних зависимостей (решение 170):
 * TF-IDF по словам письма и векторное (косинусное) сходство. Нужен для подсказки
 * модели few-shot-примерами — не для аналитики и не для дедупликации.
 */

const STOPWORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она',
  'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее',
  'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда',
  'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до',
  'вас', 'нибудь', 'опять', 'уж', 'вам', 'сказал', 'ведь', 'там', 'потом', 'себя', 'ничего',
  'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их',
  'чем', 'была', 'сам', 'чтобы', 'без', 'будто', 'человек', 'чего', 'раз', 'тоже', 'себе',
  'под', 'будет', 'этот', 'кто', 'этого', 'того', 'потому', 'этой', 'этом', 'при', 'об',
  'который', 'которая', 'которое', 'которые', 'это', 'эта', 'эти', 'мы', 'наш', 'ваш',
])

/** Слова из трёх и более букв/цифр, без стоп-слов, в нижнем регистре. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-zа-яё0-9]+/gi) ?? []
  return words.filter((word) => word.length >= 3 && !STOPWORDS.has(word))
}

function termCounts(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

/**
 * Вектор TF-IDF документа относительно частот по корпусу (`docFrequency`, число
 * документов, где встретилось слово, и общее число документов `totalDocs`).
 */
function tfidfVector(tokens: readonly string[], docFrequency: ReadonlyMap<string, number>, totalDocs: number): Map<string, number> {
  const counts = termCounts(tokens)
  const total = tokens.length || 1
  const vector = new Map<string, number>()
  for (const [term, count] of counts) {
    const tf = count / total
    const df = docFrequency.get(term) ?? 0
    // +1 в знаменателе и числителе (сглаживание) — слово, которого корпус не видел,
    // не даёт деления на ноль и не получает бесконечный вес.
    const idf = Math.log((1 + totalDocs) / (1 + df)) + 1
    vector.set(term, tf * idf)
  }
  return vector
}

function cosineSimilarity(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0
  for (const [term, weight] of a) {
    const other = b.get(term)
    if (other) dot += weight * other
  }
  const normA = Math.sqrt([...a.values()].reduce((sum, w) => sum + w * w, 0))
  const normB = Math.sqrt([...b.values()].reduce((sum, w) => sum + w * w, 0))
  if (normA === 0 || normB === 0) return 0
  return dot / (normA * normB)
}

export interface SimilarityCandidate {
  id: string
  text: string
}

export interface SimilarityMatch {
  id: string
  score: number
}

/**
 * `limit` наиболее похожих кандидатов на `targetText`, счёт по убыванию, `score > 0`.
 * Корпус для расчёта частот — сам список кандидатов плюс целевой текст: пересчитывать
 * его по всей базе не нужно — счёт нужен только для ранжирования этой одной подсказки.
 */
export function findSimilar(targetText: string, candidates: readonly SimilarityCandidate[], limit: number): SimilarityMatch[] {
  const targetTokens = tokenize(targetText)
  if (targetTokens.length === 0 || candidates.length === 0) return []

  const documents = [{ id: '__target__', tokens: targetTokens }, ...candidates.map((c) => ({ id: c.id, tokens: tokenize(c.text) }))]
  const docFrequency = new Map<string, number>()
  for (const doc of documents) {
    for (const term of new Set(doc.tokens)) docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1)
  }

  const targetVector = tfidfVector(targetTokens, docFrequency, documents.length)
  const scored = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: cosineSimilarity(targetVector, tfidfVector(tokenize(candidate.text), docFrequency, documents.length)),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit)
}
