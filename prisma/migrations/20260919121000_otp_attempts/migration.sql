-- Track failed OTP verifications so a code cannot be brute-forced within its
-- 10-minute window.
ALTER TABLE "User" ADD COLUMN "whatsappOtpAttempts" INTEGER NOT NULL DEFAULT 0;
