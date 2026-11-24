ALTER TABLE "booking_reminder" ADD COLUMN "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "booking_reminder" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "booking_reminder" ADD COLUMN "provider_message_id" text;