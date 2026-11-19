CREATE TYPE "iam"."app" AS ENUM('photos', 'cinema', 'arcade');--> statement-breakpoint
CREATE TYPE "iam"."pairing_status" AS ENUM('pending', 'approved', 'claimed', 'expired');--> statement-breakpoint
CREATE TYPE "iam"."upload_reservation_status" AS ENUM('pending', 'finished', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "iam"."object_claims" (
	"object_id" text PRIMARY KEY NOT NULL,
	"household_id" text,
	"uploaded_by" text,
	"reservation_id" uuid,
	"app" "iam"."app" NOT NULL,
	"bytes" bigint NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "object_claims_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "object_claims_bytes_nonnegative" CHECK ("iam"."object_claims"."bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "iam"."grace_periods" (
	"user_id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"household_name" text NOT NULL,
	"held_bytes" bigint DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delete_at" timestamp with time zone NOT NULL,
	CONSTRAINT "grace_periods_held_bytes_nonnegative" CHECK ("iam"."grace_periods"."held_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "iam"."households" (
	"household_id" text PRIMARY KEY NOT NULL,
	"storage_cap_bytes" bigint DEFAULT '0' NOT NULL,
	"enabled_apps" text[] NOT NULL,
	"member_limit" integer DEFAULT 4 NOT NULL,
	"used_bytes" bigint DEFAULT '0' NOT NULL,
	"reserved_bytes" bigint DEFAULT '0' NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_enabled_apps_known" CHECK ("iam"."households"."enabled_apps" <@ array['photos', 'cinema', 'arcade']::text[]),
	CONSTRAINT "households_storage_cap_bytes_nonnegative" CHECK ("iam"."households"."storage_cap_bytes" >= 0),
	CONSTRAINT "households_used_bytes_nonnegative" CHECK ("iam"."households"."used_bytes" >= 0),
	CONSTRAINT "households_reserved_bytes_nonnegative" CHECK ("iam"."households"."reserved_bytes" >= 0),
	CONSTRAINT "households_member_limit_positive" CHECK ("iam"."households"."member_limit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "iam"."instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_single_row" CHECK ("iam"."instance_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "iam"."household_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"storage_cap_bytes" bigint NOT NULL,
	"enabled_apps" text[] NOT NULL,
	"member_limit" integer DEFAULT 4 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" text,
	"household_id" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "household_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "household_invites_enabled_apps_known" CHECK ("iam"."household_invites"."enabled_apps" <@ array['photos', 'cinema', 'arcade']::text[]),
	CONSTRAINT "household_invites_token_hash_is_sha256" CHECK ("iam"."household_invites"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "household_invites_storage_cap_bytes_nonnegative" CHECK ("iam"."household_invites"."storage_cap_bytes" >= 0),
	CONSTRAINT "household_invites_member_limit_positive" CHECK ("iam"."household_invites"."member_limit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "iam"."pairing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"device_secret_hash" text NOT NULL,
	"device_name" text NOT NULL,
	"status" "iam"."pairing_status" DEFAULT 'pending' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"requester_ip" text NOT NULL,
	"approved_by" text,
	"household_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "pairing_requests_device_secret_hash_is_sha256" CHECK ("iam"."pairing_requests"."device_secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pairing_requests_failed_attempts_nonnegative" CHECK ("iam"."pairing_requests"."failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "iam"."upload_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" text,
	"user_id" text NOT NULL,
	"app" "iam"."app" NOT NULL,
	"bytes" bigint NOT NULL,
	"status" "iam"."upload_reservation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "upload_reservations_bytes_positive" CHECK ("iam"."upload_reservations"."bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "iam"."object_claims" ADD CONSTRAINT "object_claims_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."object_claims" ADD CONSTRAINT "object_claims_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."object_claims" ADD CONSTRAINT "object_claims_reservation_id_upload_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "iam"."upload_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."grace_periods" ADD CONSTRAINT "grace_periods_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."grace_periods" ADD CONSTRAINT "grace_periods_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."households" ADD CONSTRAINT "households_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."household_invites" ADD CONSTRAINT "household_invites_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."household_invites" ADD CONSTRAINT "household_invites_redeemed_by_user_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."household_invites" ADD CONSTRAINT "household_invites_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "auth"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."pairing_requests" ADD CONSTRAINT "pairing_requests_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."pairing_requests" ADD CONSTRAINT "pairing_requests_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."upload_reservations" ADD CONSTRAINT "upload_reservations_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam"."upload_reservations" ADD CONSTRAINT "upload_reservations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_claims_household_uploader_idx" ON "iam"."object_claims" USING btree ("household_id","uploaded_by");--> statement-breakpoint
CREATE INDEX "grace_periods_delete_at_idx" ON "iam"."grace_periods" USING btree ("delete_at");--> statement-breakpoint
CREATE INDEX "household_invites_email_idx" ON "iam"."household_invites" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "pairing_requests_pending_code_unique" ON "iam"."pairing_requests" USING btree ("code") WHERE "iam"."pairing_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "pairing_requests_requester_ip_idx" ON "iam"."pairing_requests" USING btree ("requester_ip","created_at");--> statement-breakpoint
CREATE INDEX "upload_reservations_pending_expiry_idx" ON "iam"."upload_reservations" USING btree ("expires_at") WHERE "iam"."upload_reservations"."status" = 'pending';