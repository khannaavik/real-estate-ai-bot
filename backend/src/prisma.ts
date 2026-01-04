import { PrismaClient } from "@prisma/client";

if (!process.env.PRISMA_ACCELERATE_URL) {
  throw new Error("PRISMA_ACCELERATE_URL is missing at runtime");
}

export const prisma = new PrismaClient({
  accelerateUrl: process.env.PRISMA_ACCELERATE_URL,
});
