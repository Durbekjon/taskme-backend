-- Normalise free-form status strings into enums without losing rows.
--
-- Existing data uses inconsistent casing ("Draft", "assigned", "ACTIVE") and
-- two clients wrote two different vocabularies for assignment status. Each
-- column is first normalised in place, then cast with USING so the values
-- survive the type change.

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'CONFIRMED', 'DECLINED', 'COMPLETED');
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'INACTIVE');
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER');
CREATE TYPE "ClientPaymentType" AS ENUM ('DEPOSIT', 'PAYMENT', 'FINAL_PAYMENT', 'REFUND');

-- ---------------------------------------------------------------------------
-- Booking.status: "Draft" / "In Progress" -> DRAFT / IN_PROGRESS
-- ---------------------------------------------------------------------------
UPDATE "Booking" SET "status" = UPPER(REPLACE(TRIM("status"), ' ', '_'));
UPDATE "Booking"
   SET "status" = 'DRAFT'
 WHERE "status" IS NULL
    OR "status" NOT IN ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking"
  ALTER COLUMN "status" TYPE "BookingStatus" USING "status"::"BookingStatus";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "Booking" ALTER COLUMN "status" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- CrewAssignment.status: collapse the web ("ACCEPTED") and mobile
-- ("confirmed") vocabularies onto the schema's own terms.
-- ---------------------------------------------------------------------------
UPDATE "CrewAssignment" SET "status" = UPPER(TRIM("status"));
UPDATE "CrewAssignment" SET "status" = 'CONFIRMED' WHERE "status" IN ('ACCEPTED', 'ACCEPT');
UPDATE "CrewAssignment" SET "status" = 'ASSIGNED'  WHERE "status" IN ('PENDING', 'INVITED');
UPDATE "CrewAssignment" SET "status" = 'DECLINED'  WHERE "status" IN ('REJECTED', 'REJECT');
UPDATE "CrewAssignment"
   SET "status" = 'ASSIGNED'
 WHERE "status" IS NULL
    OR "status" NOT IN ('ASSIGNED', 'CONFIRMED', 'DECLINED', 'COMPLETED');

ALTER TABLE "CrewAssignment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CrewAssignment"
  ALTER COLUMN "status" TYPE "AssignmentStatus" USING "status"::"AssignmentStatus";
ALTER TABLE "CrewAssignment" ALTER COLUMN "status" SET DEFAULT 'ASSIGNED';
ALTER TABLE "CrewAssignment" ALTER COLUMN "status" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- StudioMember.status / role
-- ---------------------------------------------------------------------------
UPDATE "StudioMember" SET "status" = UPPER(TRIM("status"));
UPDATE "StudioMember" SET "status" = 'INVITED' WHERE "status" IN ('PENDING');
UPDATE "StudioMember"
   SET "status" = 'INVITED'
 WHERE "status" IS NULL OR "status" NOT IN ('INVITED', 'ACTIVE', 'INACTIVE');

ALTER TABLE "StudioMember" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "StudioMember"
  ALTER COLUMN "status" TYPE "MemberStatus" USING "status"::"MemberStatus";
ALTER TABLE "StudioMember" ALTER COLUMN "status" SET DEFAULT 'INVITED';
ALTER TABLE "StudioMember" ALTER COLUMN "status" SET NOT NULL;

UPDATE "StudioMember" SET "role" = UPPER(TRIM("role"));
UPDATE "StudioMember" SET "role" = 'MEMBER' WHERE "role" IN ('WORKER', 'CREATIVE');
UPDATE "StudioMember"
   SET "role" = 'MEMBER'
 WHERE "role" IS NULL OR "role" NOT IN ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER');

ALTER TABLE "StudioMember"
  ALTER COLUMN "role" TYPE "MemberRole" USING "role"::"MemberRole";
ALTER TABLE "StudioMember" ALTER COLUMN "role" SET DEFAULT 'MEMBER';
ALTER TABLE "StudioMember" ALTER COLUMN "role" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- ClientPayment.paymentType
-- ---------------------------------------------------------------------------
UPDATE "ClientPayment" SET "paymentType" = UPPER(REPLACE(TRIM("paymentType"), ' ', '_'));
UPDATE "ClientPayment"
   SET "paymentType" = 'PAYMENT'
 WHERE "paymentType" IS NULL
    OR "paymentType" NOT IN ('DEPOSIT', 'PAYMENT', 'FINAL_PAYMENT', 'REFUND');

ALTER TABLE "ClientPayment"
  ALTER COLUMN "paymentType" TYPE "ClientPaymentType" USING "paymentType"::"ClientPaymentType";
ALTER TABLE "ClientPayment" ALTER COLUMN "paymentType" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- New columns for data the clients were already sending but the API dropped.
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkerProfile" ADD COLUMN "primaryGear" TEXT;
ALTER TABLE "Client" ADD COLUMN "instagramHandle" TEXT;
