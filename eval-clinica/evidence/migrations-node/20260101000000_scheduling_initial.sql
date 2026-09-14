CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."appointment_types" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "default_duration_minutes" INTEGER NOT NULL,
  "required_skill" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "appointment_types_tenant_id_idx" ON "clinics"."appointment_types" ("tenant_id");
CREATE INDEX "appointment_types_data_key_idx" ON "clinics"."appointment_types" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."clinics" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."patients" (
  "id" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "date_of_birth" TIMESTAMP WITH TIME ZONE NOT NULL,
  "insurance_policy_ref" TEXT NOT NULL,
  "user_ref" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "patients_tenant_id_idx" ON "clinics"."patients" ("tenant_id");
CREATE INDEX "patients_data_key_idx" ON "clinics"."patients" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."practitioners" (
  "id" UUID NOT NULL,
  "clinic" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "skills" TEXT[] NOT NULL,
  "cost_rate" DECIMAL(19, 4) NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("clinic") REFERENCES "clinics"."clinics" ON DELETE RESTRICT
);
CREATE INDEX "practitioners_clinic_idx" ON "clinics"."practitioners" ("clinic");
CREATE INDEX "practitioners_tenant_id_idx" ON "clinics"."practitioners" ("tenant_id");
CREATE INDEX "practitioners_data_key_idx" ON "clinics"."practitioners" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."availability_exceptions" (
  "id" UUID NOT NULL,
  "practitioner_id" UUID NOT NULL,
  "on_date" TIMESTAMP WITH TIME ZONE NOT NULL,
  "available" BOOLEAN NOT NULL,
  "start_minute" INTEGER NOT NULL,
  "end_minute" INTEGER NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("practitioner_id") REFERENCES "clinics"."practitioners" ON DELETE CASCADE
);
CREATE INDEX "availability_exceptions_practitioner_id_idx" ON "clinics"."availability_exceptions" ("practitioner_id");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."availability_windows" (
  "id" UUID NOT NULL,
  "practitioner_id" UUID NOT NULL,
  "day" TEXT NOT NULL,
  "start_minute" INTEGER NOT NULL,
  "end_minute" INTEGER NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("practitioner_id") REFERENCES "clinics"."practitioners" ON DELETE CASCADE
);
CREATE INDEX "availability_windows_practitioner_id_idx" ON "clinics"."availability_windows" ("practitioner_id");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."referrals" (
  "id" UUID NOT NULL,
  "patient" UUID NOT NULL,
  "specialist_name" TEXT NOT NULL,
  "specialist_email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "sent_at" TIMESTAMP WITH TIME ZONE NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("patient") REFERENCES "clinics"."patients" ON DELETE RESTRICT
);
CREATE INDEX "referrals_patient_idx" ON "clinics"."referrals" ("patient");
CREATE INDEX "referrals_tenant_id_idx" ON "clinics"."referrals" ("tenant_id");
CREATE INDEX "referrals_data_key_idx" ON "clinics"."referrals" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."rooms" (
  "id" UUID NOT NULL,
  "clinic" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "seats" INTEGER NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("clinic") REFERENCES "clinics"."clinics" ON DELETE RESTRICT
);
CREATE INDEX "rooms_clinic_idx" ON "clinics"."rooms" ("clinic");
CREATE INDEX "rooms_tenant_id_idx" ON "clinics"."rooms" ("tenant_id");
CREATE INDEX "rooms_data_key_idx" ON "clinics"."rooms" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."appointments" (
  "id" UUID NOT NULL,
  "clinic" UUID NOT NULL,
  "patient" UUID NOT NULL,
  "practitioner" UUID NOT NULL,
  "room" UUID NOT NULL,
  "appt_type" UUID NOT NULL,
  "start_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "cancel_reason" TEXT NULL,
  "patient_user_ref" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("clinic") REFERENCES "clinics"."clinics" ON DELETE RESTRICT,
  FOREIGN KEY ("patient") REFERENCES "clinics"."patients" ON DELETE RESTRICT,
  FOREIGN KEY ("practitioner") REFERENCES "clinics"."practitioners" ON DELETE RESTRICT,
  FOREIGN KEY ("room") REFERENCES "clinics"."rooms" ON DELETE RESTRICT,
  FOREIGN KEY ("appt_type") REFERENCES "clinics"."appointment_types" ON DELETE RESTRICT
);
CREATE INDEX "appointments_clinic_idx" ON "clinics"."appointments" ("clinic");
CREATE INDEX "appointments_patient_idx" ON "clinics"."appointments" ("patient");
CREATE INDEX "appointments_practitioner_idx" ON "clinics"."appointments" ("practitioner");
CREATE INDEX "appointments_room_idx" ON "clinics"."appointments" ("room");
CREATE INDEX "appointments_appt_type_idx" ON "clinics"."appointments" ("appt_type");
CREATE INDEX "appointments_tenant_id_idx" ON "clinics"."appointments" ("tenant_id");
CREATE INDEX "appointments_data_key_idx" ON "clinics"."appointments" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."encounters" (
  "id" UUID NOT NULL,
  "appointment" UUID NOT NULL,
  "patient" UUID NOT NULL,
  "notes" TEXT NOT NULL,
  "height_cm" DECIMAL NOT NULL,
  "weight_kg" DECIMAL NOT NULL,
  "systolic" INTEGER NOT NULL,
  "diastolic" INTEGER NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("appointment") REFERENCES "clinics"."appointments" ON DELETE RESTRICT,
  FOREIGN KEY ("patient") REFERENCES "clinics"."patients" ON DELETE RESTRICT
);
CREATE INDEX "encounters_appointment_idx" ON "clinics"."encounters" ("appointment");
CREATE INDEX "encounters_patient_idx" ON "clinics"."encounters" ("patient");
CREATE INDEX "encounters_tenant_id_idx" ON "clinics"."encounters" ("tenant_id");
CREATE INDEX "encounters_data_key_idx" ON "clinics"."encounters" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "clinics";
CREATE TABLE "clinics"."waitlist_entries" (
  "id" UUID NOT NULL,
  "patient" UUID NOT NULL,
  "appt_type" UUID NOT NULL,
  "requested_after" TIMESTAMP WITH TIME ZONE NOT NULL,
  "state" TEXT NOT NULL,
  "offered_appointment" UUID NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("patient") REFERENCES "clinics"."patients" ON DELETE RESTRICT,
  FOREIGN KEY ("appt_type") REFERENCES "clinics"."appointment_types" ON DELETE RESTRICT,
  FOREIGN KEY ("offered_appointment") REFERENCES "clinics"."appointments" ON DELETE RESTRICT
);
CREATE INDEX "waitlist_entries_patient_idx" ON "clinics"."waitlist_entries" ("patient");
CREATE INDEX "waitlist_entries_appt_type_idx" ON "clinics"."waitlist_entries" ("appt_type");
CREATE INDEX "waitlist_entries_offered_appointment_idx" ON "clinics"."waitlist_entries" ("offered_appointment");
CREATE INDEX "waitlist_entries_tenant_id_idx" ON "clinics"."waitlist_entries" ("tenant_id");
CREATE INDEX "waitlist_entries_data_key_idx" ON "clinics"."waitlist_entries" ("data_key" text_pattern_ops);
