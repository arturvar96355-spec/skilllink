import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Prisma и драйвер Postgres не бандлятся: работают как обычные node-модули на сервере.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
