/**
 * Поиск ответа на задачу «не робот» (src/shared/auth/captcha.ts, решение 100):
 * число, при котором SHA-256 от «соль + число» совпадает с хешем задачи.
 *
 * Работает и в фоновом потоке, и на странице — там, где фоновый поток не завёлся.
 */

/** Хеши считаются пачками: по одному с ожиданием каждого перебор шёл бы в разы дольше. */
const BATCH = 500

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

export async function findNumber(salt: string, challenge: string, maxNumber: number): Promise<number | null> {
  const target = hexToBytes(challenge)
  const encoder = new TextEncoder()
  for (let start = 0; start <= maxNumber; start += BATCH) {
    const end = Math.min(start + BATCH - 1, maxNumber)
    const digests = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, offset) =>
        crypto.subtle.digest('SHA-256', encoder.encode(salt + (start + offset))),
      ),
    )
    const found = digests.findIndex((digest) => sameBytes(new Uint8Array(digest), target))
    if (found !== -1) return start + found
  }
  return null
}
