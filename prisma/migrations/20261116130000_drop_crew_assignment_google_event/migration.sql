-- Calendar events are now matched by extended properties, not stored ids.
ALTER TABLE "CrewAssignment" DROP COLUMN "googleEventId";
