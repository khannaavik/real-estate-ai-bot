// backend/src/prisma.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("[PRISMA] FATAL: DATABASE_URL is not set in environment variables");
  process.exit(1);
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: connectionString,
    },
  },
});

// Test database connection on initialization
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("[PRISMA] Database connection test failed:", error);
    return false;
  }
}
