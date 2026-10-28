-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_studioId_fkey";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "clientId",
ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "CrewAssignment" ADD COLUMN     "deposit" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "expoPushToken" TEXT;

-- AlterTable
ALTER TABLE "WorkerPayment" ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING';

-- DropTable
DROP TABLE "Client";

