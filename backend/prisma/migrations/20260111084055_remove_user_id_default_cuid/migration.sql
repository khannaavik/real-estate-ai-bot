-- Remove default constraint from User.id
-- User.id will now use Clerk userId (user_xxx format) instead of auto-generated CUID
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;
