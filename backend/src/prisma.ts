import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // REQUIRED for Supabase + Railway
  },
});

const adapter = new PrismaPg(pool);


export const prisma = new PrismaClient({
  accelerateUrl: process.env.PRISMA_ACCELERATE_URL,
});
