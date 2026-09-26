import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import type { VendorContactChannel } from '@/shared/contracts/enums'
import type { VendorListQuery } from './vendors.schema'

const listSelect = {
  id: true,
  name: true,
  isMock: true,
  updatedAt: true,
  products: { orderBy: { name: 'asc' }, select: { id: true, name: true, status: true, _count: { select: { cooperations: true } } } },
  _count: { select: { contacts: true } },
} satisfies Prisma.VendorSelect

export type VendorListRow = Prisma.VendorGetPayload<{ select: typeof listSelect }>

export async function findMany(query: VendorListQuery): Promise<{ rows: VendorListRow[]; total: number }> {
  const where: Prisma.VendorWhereInput = query.q
    ? { OR: [{ name: textContains(query.q) }, { products: { some: { name: textContains(query.q) } } }] }
    : {}
  const [rows, total] = await Promise.all([
    prisma.vendor.findMany({ where, select: listSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma.vendor.count({ where }),
  ])
  return { rows, total }
}

const detailSelect = {
  id: true,
  name: true,
  isMock: true,
  createdAt: true,
  updatedAt: true,
  products: {
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      category: true,
      version: true,
      status: true,
      _count: { select: { cooperations: true } },
      schoolCourses: { orderBy: { name: 'asc' }, select: { id: true, name: true, productId: true } },
      cooperations: {
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          status: true,
          university: { select: { id: true, name: true } },
          program: { select: { id: true, name: true } },
        },
      },
    },
  },
  contacts: {
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      preferredChannels: true,
      legalBasis: true,
      products: { select: { productId: true } },
    },
  },
} satisfies Prisma.VendorSelect

export type VendorDetailRow = Prisma.VendorGetPayload<{ select: typeof detailSelect }>

export async function findById(id: string): Promise<VendorDetailRow | null> {
  return prisma.vendor.findUnique({ where: { id }, select: detailSelect })
}

// ─────────────────────────── Загрузка ───────────────────────────

/** Всё, что нужно загрузке для сопоставления: вендоры, продукты, контакты. Объёмы — десятки строк. */
export async function loadCatalog() {
  const [vendors, products, contacts] = await Promise.all([
    prisma.vendor.findMany({ select: { id: true, name: true, nameKey: true } }),
    prisma.iTProduct.findMany({ select: { id: true, name: true, vendorId: true, vendor: { select: { name: true } } } }),
    prisma.vendorContact.findMany({
      select: {
        id: true,
        vendorId: true,
        fullName: true,
        email: true,
        phone: true,
        preferredChannels: true,
        products: { select: { productId: true } },
      },
    }),
  ])
  return { vendors, products, contacts }
}

export type Catalog = Awaited<ReturnType<typeof loadCatalog>>

/** Шаги записи загрузки — в порядке исполнения, одной транзакцией. */
export type VendorImportStep =
  | { kind: 'vendor'; ref: string; name: string; nameKey: string }
  | { kind: 'product-create'; ref: string; name: string; category: string; vendorRef: string }
  | { kind: 'product-link'; productId: string; vendorRef: string }
  | {
      kind: 'contact-create'
      vendorRef: string
      fullName: string
      email: string | null
      phone: string | null
      channels: VendorContactChannel[]
      productRefs: string[]
      basisReference: string
    }
  | {
      kind: 'contact-update'
      contactId: string
      email: string | null
      phone: string | null
      channels: VendorContactChannel[]
      productRefs: string[]
    }

/**
 * Применяет шаги загрузки. `ref` — либо id существующей записи, либо временная
 * метка новой («new:…»), которая превращается в id после создания.
 */
export async function applyImport(steps: readonly VendorImportStep[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ids = new Map<string, string>()
    const resolve = (ref: string): string => ids.get(ref) ?? ref

    for (const step of steps) {
      switch (step.kind) {
        case 'vendor': {
          const row = await tx.vendor.create({ data: { name: step.name, nameKey: step.nameKey }, select: { id: true } })
          ids.set(step.ref, row.id)
          break
        }
        case 'product-create': {
          const row = await tx.iTProduct.create({
            data: { name: step.name, category: step.category, status: 'ACTIVE', vendorId: resolve(step.vendorRef), isMock: false },
            select: { id: true },
          })
          ids.set(step.ref, row.id)
          break
        }
        case 'product-link':
          await tx.iTProduct.update({ where: { id: step.productId }, data: { vendorId: resolve(step.vendorRef) } })
          break
        case 'contact-create':
          await tx.vendorContact.create({
            data: {
              vendorId: resolve(step.vendorRef),
              fullName: step.fullName,
              email: step.email,
              phone: step.phone,
              preferredChannels: step.channels,
              legalBasis: 'LEGITIMATE_INTEREST',
              basisReference: step.basisReference,
              products: { create: step.productRefs.map((ref) => ({ productId: resolve(ref) })) },
            },
          })
          break
        case 'contact-update':
          await tx.vendorContact.update({
            where: { id: step.contactId },
            data: {
              email: step.email,
              phone: step.phone,
              preferredChannels: step.channels,
              products: {
                deleteMany: {},
                create: step.productRefs.map((ref) => ({ productId: resolve(ref) })),
              },
            },
          })
          break
      }
    }
  })
}
