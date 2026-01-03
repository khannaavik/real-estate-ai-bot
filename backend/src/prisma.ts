import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// PrismaClient instantiated once without adapters, extensions, or super() calls
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development"
    ? ["query", "error", "warn"]
    : ["error"],
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

// Export as default and named export for compatibility
export default prisma;
export { prisma };
