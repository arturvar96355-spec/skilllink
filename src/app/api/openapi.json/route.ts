import { NextResponse } from 'next/server'
import { handle } from '@/shared/http'
import { buildOpenApiDocument } from '@/shared/openapi/build'

/**
 * Спецификация OpenAPI живого сервера.
 * Авторизация не требуется: это описание интерфейса, а не данные.
 */
export const GET = handle(async () => {
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000'
  return NextResponse.json(buildOpenApiDocument(baseUrl), { status: 200 })
})
