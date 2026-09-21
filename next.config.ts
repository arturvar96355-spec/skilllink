import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // standalone-сборка кладёт в .next/standalone сервер со всеми нужными зависимостями:
  // образу не нужен весь node_modules, и он получается в разы меньше.
  output: 'standalone',
  // Prisma и драйвер Postgres не бандлятся: работают как обычные node-модули на сервере.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
