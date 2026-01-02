// backend/prisma.config.ts

import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // This is where DATABASE_URL is now read from
    url: env("DATABASE_URL"),
  },
});
