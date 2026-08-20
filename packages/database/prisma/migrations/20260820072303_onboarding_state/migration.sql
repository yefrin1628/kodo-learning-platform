-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "goalMin" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "product" TEXT NOT NULL DEFAULT 'code';
