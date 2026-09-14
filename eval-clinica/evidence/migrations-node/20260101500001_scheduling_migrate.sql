ALTER TABLE "clinics"."patients" ADD COLUMN "preferred_language" TEXT NOT NULL DEFAULT 'en';
--> statement-breakpoint
ALTER TABLE "clinics"."patients" ALTER COLUMN "preferred_language" DROP DEFAULT;
