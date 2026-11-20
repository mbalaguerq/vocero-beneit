CREATE TABLE "booking_reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"booking_id" text NOT NULL,
	"type" text DEFAULT 'd1' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp,
	"due_at" timestamp NOT NULL,
	"sent_at" timestamp,
	"cancelled_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_reminder" ADD CONSTRAINT "booking_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminder" ADD CONSTRAINT "booking_reminder_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reminder_org_booking_type_uq" ON "booking_reminder" USING btree ("organization_id","booking_id","type");--> statement-breakpoint
CREATE INDEX "booking_reminder_due_idx" ON "booking_reminder" USING btree ("status","due_at","lease_until");
