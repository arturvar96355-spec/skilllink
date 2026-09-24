import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

function request(path: string, withSession: boolean): NextRequest {
  const req = new NextRequest(`https://skilllink.test${path}`)
  if (withSession) req.cookies.set('authjs.session-token', 'x')
  return req
}

const redirectTarget = (res: Response) => res.headers.get('location')

describe('middleware', () => {
  it('без сессии страницы системы уводят на вход', () => {
    expect(redirectTarget(middleware(request('/cooperations', false)))).toBe(
      'https://skilllink.test/login?from=%2Fcooperations',
    )
  })

  it('презентация открыта без сессии — вместе с её файлами', () => {
    expect(redirectTarget(middleware(request('/presentation', false)))).toBeNull()
    expect(redirectTarget(middleware(request('/presentation/scene.glb', false)))).toBeNull()
  })

  it('презентация открыта и с сессией: на главную не уводит', () => {
    expect(redirectTarget(middleware(request('/presentation', true)))).toBeNull()
  })

  it('похожий адрес не открывается', () => {
    expect(redirectTarget(middleware(request('/presentations-secret', false)))).toContain('/login')
  })

  it('вошедшего со страницы входа уводит на главную', () => {
    expect(redirectTarget(middleware(request('/login', true)))).toBe('https://skilllink.test/')
  })
})
