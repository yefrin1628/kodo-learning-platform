-- AlterTable
ALTER TABLE "exercise_progress" DROP COLUMN "correct",
ADD COLUMN     "completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correctAnswers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mistakes" INTEGER NOT NULL DEFAULT 0;

