import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const accelerateUrl = process.env.PRISMA_ACCELERATE_URL;

if (!accelerateUrl) {
  throw new Error("PRISMA_ACCELERATE_URL is missing at runtime");
}

export const prisma = new PrismaClient({
  accelerateUrl,
});
