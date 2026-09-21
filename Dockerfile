# Образ приложения SkillLink.
#
# Сборка многоступенчатая: зависимости, сборка и рантайм разделены, чтобы в итоговый
# образ не попали ни исходники, ни инструменты сборки, ни devDependencies.
#
# Все компоненты — свободное ПО, ставится в контур заказчика. Зарубежные облачные
# сервисы не используются.

# ── Зависимости ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma требует OpenSSL для движка запросов.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# postinstall генерирует клиент Prisma — без него сборка не найдёт @/generated/prisma.
RUN npm ci

# ── Сборка ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY . .

# Сборка не требует ни подключения к базе, ни боевых секретов:
# DATABASE_URL и AUTH_SECRET нужны только на запуске контейнера.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Рантайм ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Приложение работает не от root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# standalone уже содержит нужные зависимости — весь node_modules не копируется.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Миграции и схема нужны, чтобы применять их при развёртывании отдельной командой.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

USER nextjs
EXPOSE 3000

# Проверка живости: контейнер считается здоровым, только когда доступна и база.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
