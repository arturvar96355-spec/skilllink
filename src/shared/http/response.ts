import { NextResponse } from 'next/server'
import { AppError } from './errors'

export interface PageMeta {
  page: number
  pageSize: number
  total: number
}

/** Успешный ответ с одним объектом: { data }. */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status })
}

/** Ответ на создание записи. */
export function created<T>(data: T): NextResponse {
  return ok(data, 201)
}

/** Успешный ответ со списком: { data, meta }. Модуль может расширить meta своими полями. */
export function okList<T, M extends PageMeta>(data: T[], meta: M): NextResponse {
  return NextResponse.json({ data, meta }, { status: 200 })
}

/** Ответ об ошибке: { error: { code, message, details } }. */
export function fail(error: AppError): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    { status: error.status },
  )
}
