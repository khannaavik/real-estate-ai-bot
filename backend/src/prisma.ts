// backend/src/prisma.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Prisma 7 automatically reads DATABASE_URL from environment variables
// No need to pass it explicitly to PrismaClient constructor
export const prisma = new PrismaClient();

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
