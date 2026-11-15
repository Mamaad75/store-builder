-- At most one reset token per user, enforced by the database. Keep only the newest row of any user that already has several.
DELETE FROM "PasswordResetToken" a
USING "PasswordResetToken" b
WHERE a."userId" = b."userId"
  AND (a."createdAt" < b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

-- DropIndex
DROP INDEX "PasswordResetToken_userId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_userId_key" ON "PasswordResetToken"("userId");
