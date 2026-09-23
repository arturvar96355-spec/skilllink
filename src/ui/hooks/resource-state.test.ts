import { describe, expect, it } from 'vitest'
import { presentResource, type LoadedResource } from './resource-state'

const loaded = (path: string, data: string | null = `данные ${path}`): LoadedResource<string, Error> => ({
  path,
  data,
  meta: null,
  error: null,
})

describe('что показывает загрузка данных', () => {
  it('адрес пропал — данных нет: панель рекомендации закрывается', () => {
    // Раньше здесь оставались данные прежней рекомендации, и панель не закрывалась.
    expect(presentResource(loaded('/api/recommendations/1'), null, false, false)).toMatchObject({
      data: null,
      isLoading: false,
    })
  })

  it('новый адрес — данные прежнего не выдаются за новые', () => {
    // Программы прежнего вуза в форме связки, результаты прошлого поиска.
    expect(presentResource(loaded('/api/programs?universityId=A'), '/api/programs?universityId=B', true, false)).toMatchObject({
      data: null,
      isLoading: true,
      isRefreshing: false,
    })
  })

  it('до первого ответа — загрузка', () => {
    expect(presentResource(null, '/api/x', false, false)).toMatchObject({ data: null, isLoading: true })
  })

  it('список с фильтром по просьбе экрана держит прежние строки, пока грузятся новые', () => {
    expect(presentResource(loaded('/api/universities?page=1'), '/api/universities?page=2', true, true)).toMatchObject({
      data: 'данные /api/universities?page=1',
      isLoading: false,
      isRefreshing: true,
    })
  })

  it('возврат к загруженному адресу показывает его данные сразу', () => {
    expect(presentResource(loaded('/api/documents?cooperationId=1'), '/api/documents?cooperationId=1', true, false)).toMatchObject({
      data: 'данные /api/documents?cooperationId=1',
      isRefreshing: true,
    })
  })

  it('ошибка относится только к своему адресу', () => {
    const failed = { ...loaded('/api/x', null), error: new Error('нет') }
    expect(presentResource(failed, '/api/x', false, false).error).not.toBeNull()
    expect(presentResource(failed, '/api/y', true, true).error).toBeNull()
  })
})
