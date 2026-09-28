-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateSequence (human-readable reference numbers, used by column defaults below)
CREATE SEQUENCE "request_ref_seq";
CREATE SEQUENCE "booking_ref_seq";
CREATE SEQUENCE "work_order_ref_seq";

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('CUSTOMER', 'PROVIDER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CheckType" AS ENUM ('BUSINESS_IDENTITY', 'TECHNICAL_EXPERIENCE', 'REFERENCES', 'INSURANCE', 'QUALIFICATION');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('DIAGNOSTIC', 'MAINTENANCE', 'BREAKDOWN');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'OPEN', 'BOOKING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestSource" AS ENUM ('MARKETPLACE', 'BREAKDOWN_ROUTING', 'MAINTENANCE_PLAN');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('INVITED', 'DECLINED', 'OFFERED', 'REVOKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'WITHDRAWN', 'SELECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OfferVersionStatus" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED', 'WITHDRAWN', 'SELECTED', 'NOT_SELECTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OfferKind" AS ENUM ('DIAGNOSTIC', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'NO_SHOW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PartySide" AS ENUM ('CUSTOMER', 'PROVIDER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "RescheduleStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('SCHEDULED', 'EN_ROUTE', 'ON_SITE', 'AWAITING_APPROVAL', 'DIAGNOSED', 'AWAITING_PARTS', 'IN_PROGRESS', 'REPORT_SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AckStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "JobEventType" AS ENUM ('BOOKING_REQUESTED', 'BOOKING_CONFIRMED', 'BOOKING_DECLINED', 'BOOKING_EXPIRED', 'BOOKING_CANCELLED', 'NO_SHOW_REPORTED', 'RESCHEDULE_PROPOSED', 'RESCHEDULE_ACCEPTED', 'RESCHEDULE_REJECTED', 'EN_ROUTE', 'ON_SITE', 'REPAIR_QUOTE_ISSUED', 'REPAIR_QUOTE_APPROVED', 'REPAIR_QUOTE_REJECTED', 'REPAIR_QUOTE_WITHDRAWN', 'WORK_STARTED', 'AWAITING_PARTS', 'REPORT_SUBMITTED', 'ACKNOWLEDGED', 'DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED', 'PAYMENT_REPORTED', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'PAYMENT_REVERSED');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('SHARED', 'PROVIDER_INTERNAL', 'CUSTOMER_PRIVATE');

-- CreateEnum
CREATE TYPE "QuoteVersionStatus" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LineKind" AS ENUM ('PART', 'LABOR', 'TRAVEL', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PHOTO', 'ATTACHMENT', 'REPORT_PDF', 'QUOTE_PDF', 'PAYMENT_EVIDENCE');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('OWNER_ONLY', 'SHARED_PARTIES', 'QUOTING_SHARED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER_EXTERNAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REPORTED', 'CONFIRMED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentEventType" AS ENUM ('REPORTED', 'RECORDED_BY_PAYEE', 'CONFIRMED', 'REJECTED', 'REVERSED', 'ADMIN_CORRECTION');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'PAUSED', 'ENDED', 'DECLINED');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('DRAFT_CREATED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING_MODERATION', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DisputeEventType" AS ENUM ('OPENED', 'COMMENT', 'STATUS_CHANGED', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('PERIOD_RECORDED', 'PLAN_ASSIGNED', 'CORRECTION');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,
    "active_organization_id" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" BIGINT NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "OrgType" NOT NULL,
    "city" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "inviter_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_category" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label_fr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_category" (
    "id" TEXT NOT NULL,
    "service_category_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label_fr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_area" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cities" TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Casablanca',
    "routing_hours" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_profile" (
    "id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "service_hours" JSONB NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "provider_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_service_area" (
    "provider_profile_id" TEXT NOT NULL,
    "service_area_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,

    CONSTRAINT "provider_service_area_pkey" PRIMARY KEY ("provider_profile_id","service_area_id")
);

-- CreateTable
CREATE TABLE "provider_category" (
    "provider_profile_id" TEXT NOT NULL,
    "equipment_category_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,

    CONSTRAINT "provider_category_pkey" PRIMARY KEY ("provider_profile_id","equipment_category_id")
);

-- CreateTable
CREATE TABLE "provider_check" (
    "id" TEXT NOT NULL,
    "provider_profile_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "type" "CheckType" NOT NULL,
    "status" "CheckStatus" NOT NULL DEFAULT 'PENDING',
    "public_note" TEXT,
    "internal_note" TEXT,
    "checked_by_id" TEXT,
    "checked_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_profile" (
    "id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technician_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_skill" (
    "technician_id" TEXT NOT NULL,
    "equipment_category_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,

    CONSTRAINT "technician_skill_pkey" PRIMARY KEY ("technician_id","equipment_category_id")
);

-- CreateTable
CREATE TABLE "availability_window" (
    "id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_off" (
    "id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reservation" (
    "id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "buffer_before_min" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_min" INTEGER NOT NULL DEFAULT 0,
    "blocked_start" TIMESTAMPTZ(3) NOT NULL,
    "blocked_end" TIMESTAMPTZ(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "released_at" TIMESTAMPTZ(3),
    "release_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "service_area_id" TEXT,
    "access_notes" TEXT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "installed_year" INTEGER,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT ('DEM-' || lpad((nextval('request_ref_seq'))::text, 6, '0')),
    "customer_org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "equipment_category_id" TEXT NOT NULL,
    "service_area_id" TEXT,
    "city" TEXT NOT NULL,
    "kind" "RequestKind" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "RequestSource" NOT NULL DEFAULT 'MARKETPLACE',
    "title" TEXT NOT NULL,
    "symptoms" TEXT NOT NULL,
    "preferred_windows" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" TEXT,
    "cancel_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "maintenance_plan_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_invitation" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'INVITED',
    "invited_by_id" TEXT NOT NULL,
    "invited_as_admin" BOOLEAN NOT NULL DEFAULT false,
    "brief" JSONB NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "decline_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "invitation_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_version" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "OfferVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "OfferKind" NOT NULL,
    "scope" TEXT NOT NULL,
    "callout_fee_minor" INTEGER,
    "service_fee_minor" INTEGER,
    "tax_rate_bp" INTEGER,
    "tax_note" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "subtotal_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMPTZ(3),
    "window_end" TIMESTAMPTZ(3),
    "estimated_duration_min" INTEGER,
    "exclusions" TEXT,
    "cancellation_terms" TEXT,
    "warranty_terms" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "snapshot_hash" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "issued_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT ('RDV-' || lpad((nextval('booking_ref_seq'))::text, 6, '0')),
    "request_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "offer_version_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "window_start" TIMESTAMPTZ(3),
    "window_end" TIMESTAMPTZ(3),
    "estimated_duration_min" INTEGER,
    "confirmation_deadline" TIMESTAMPTZ(3) NOT NULL,
    "selected_by_id" TEXT NOT NULL,
    "technician_id" TEXT,
    "technician_name" TEXT,
    "scheduled_start" TIMESTAMPTZ(3),
    "scheduled_end" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" TEXT,
    "declined_at" TIMESTAMPTZ(3),
    "decline_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" TEXT,
    "cancelled_by_side" "PartySide",
    "cancel_reason" TEXT,
    "no_show_at" TIMESTAMPTZ(3),
    "no_show_side" "PartySide",
    "no_show_reported_by_id" TEXT,
    "no_show_note" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reschedule_proposal" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "proposed_by_side" "PartySide" NOT NULL,
    "proposed_by_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "technician_id" TEXT,
    "technician_name" TEXT,
    "reason" TEXT NOT NULL,
    "status" "RescheduleStatus" NOT NULL DEFAULT 'PENDING',
    "responded_by_id" TEXT,
    "responded_at" TIMESTAMPTZ(3),
    "response_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reschedule_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT ('INT-' || lpad((nextval('work_order_ref_seq'))::text, 6, '0')),
    "booking_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "maintenance_scope_authorized" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgment" "AckStatus",
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_id" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_event" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "type" "JobEventType" NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "actor_user_id" TEXT,
    "actor_org_id" TEXT,
    "actor_side" "PartySide",
    "actor_name" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_note" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "author_org_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_quote" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_quote_version" (
    "id" TEXT NOT NULL,
    "repair_quote_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "QuoteVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "scope_summary" TEXT NOT NULL,
    "estimated_duration_min" INTEGER,
    "timing_note" TEXT,
    "exclusions" TEXT,
    "warranty_terms" TEXT,
    "valid_until" TIMESTAMPTZ(3),
    "revision_reason" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "subtotal_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL DEFAULT 0,
    "snapshot_hash" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "issued_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_quote_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_item" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity_milli" INTEGER NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL,
    "subtotal_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,

    CONSTRAINT "quote_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "repair_quote_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_org_id" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_report" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "work_performed" TEXT NOT NULL,
    "parts_used" TEXT,
    "recommendations" TEXT,
    "next_service_date" DATE,
    "approved_version_ids" TEXT[],
    "repair_declined" BOOLEAN NOT NULL DEFAULT false,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot_hash" TEXT NOT NULL,

    CONSTRAINT "service_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "owner_org_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "customer_org_id" TEXT,
    "provider_org_id" TEXT,
    "request_id" TEXT,
    "work_order_id" TEXT,
    "report_id" TEXT,
    "equipment_id" TEXT,
    "payment_id" TEXT,
    "repair_quote_version_id" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "visibility" "DocumentVisibility" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_record" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "method" "PaymentMethod" NOT NULL,
    "paid_on" DATE NOT NULL,
    "external_reference" TEXT,
    "note" TEXT,
    "status" "PaymentStatus" NOT NULL,
    "reported_side" "PartySide" NOT NULL,
    "reported_by_id" TEXT NOT NULL,
    "reported_by_org_id" TEXT NOT NULL,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "reversed_by_id" TEXT,
    "reversed_at" TIMESTAMPTZ(3),
    "reversal_reason" TEXT,
    "evidence_document_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_event" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "type" "PaymentEventType" NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_org_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plan" (
    "id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "interval_months" INTEGER NOT NULL,
    "reminder_lead_days" INTEGER NOT NULL DEFAULT 14,
    "first_due_date" DATE NOT NULL,
    "next_due_date" DATE,
    "status" "PlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposed_by_id" TEXT NOT NULL,
    "consented_by_id" TEXT,
    "consented_at" TIMESTAMPTZ(3),
    "status_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_occurrence" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "occurrence_key" TEXT NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'DRAFT_CREATED',
    "draft_request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_MODERATION',
    "moderated_by_id" TEXT,
    "moderated_at" TIMESTAMPTZ(3),
    "moderation_note" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_response" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "opened_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution_summary" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_event" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_org_id" TEXT NOT NULL,
    "actor_side" "PartySide" NOT NULL,
    "actor_name" TEXT NOT NULL,
    "type" "DisputeEventType" NOT NULL,
    "body" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "period" TEXT NOT NULL DEFAULT 'MONTH',
    "max_staff" INTEGER NOT NULL,
    "tax_note" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_subscription" (
    "id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "paid_until" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_event" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "provider_org_id" TEXT NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "amount_minor" INTEGER,
    "currency" TEXT,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_referral" (
    "id" TEXT NOT NULL,
    "customer_org_id" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_message" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization_name" TEXT,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "user_id" TEXT,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "event_id" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actor_user_id" TEXT,
    "actor_org_id" TEXT,
    "status" "QueueStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_delivery" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text_body" TEXT NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_org_id" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "account"("user_id");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_key_key" ON "rate_limit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "organization_type_idx" ON "organization"("type");

-- CreateIndex
CREATE INDEX "member_user_id_idx" ON "member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_organization_id_user_id_key" ON "member"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "invitation_organization_id_status_idx" ON "invitation"("organization_id", "status");

-- CreateIndex
CREATE INDEX "invitation_email_status_idx" ON "invitation"("email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_category_code_key" ON "service_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_category_code_key" ON "equipment_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_area_code_key" ON "service_area"("code");

-- CreateIndex
CREATE UNIQUE INDEX "provider_profile_provider_org_id_key" ON "provider_profile"("provider_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_profile_slug_key" ON "provider_profile"("slug");

-- CreateIndex
CREATE INDEX "provider_profile_status_idx" ON "provider_profile"("status");

-- CreateIndex
CREATE INDEX "provider_service_area_service_area_id_idx" ON "provider_service_area"("service_area_id");

-- CreateIndex
CREATE INDEX "provider_category_equipment_category_id_idx" ON "provider_category"("equipment_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_check_provider_profile_id_type_key" ON "provider_check"("provider_profile_id", "type");

-- CreateIndex
CREATE INDEX "technician_profile_provider_org_id_active_idx" ON "technician_profile"("provider_org_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "technician_profile_provider_org_id_user_id_key" ON "technician_profile"("provider_org_id", "user_id");

-- CreateIndex
CREATE INDEX "availability_window_technician_id_weekday_idx" ON "availability_window"("technician_id", "weekday");

-- CreateIndex
CREATE INDEX "time_off_technician_id_starts_at_idx" ON "time_off"("technician_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_reservation_provider_org_id_starts_at_idx" ON "appointment_reservation"("provider_org_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_reservation_booking_id_idx" ON "appointment_reservation"("booking_id");

-- CreateIndex
CREATE INDEX "site_customer_org_id_archived_at_idx" ON "site"("customer_org_id", "archived_at");

-- CreateIndex
CREATE INDEX "equipment_customer_org_id_archived_at_idx" ON "equipment"("customer_org_id", "archived_at");

-- CreateIndex
CREATE INDEX "equipment_site_id_idx" ON "equipment"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_request_reference_key" ON "service_request"("reference");

-- CreateIndex
CREATE INDEX "service_request_customer_org_id_status_created_at_idx" ON "service_request"("customer_org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "service_request_status_kind_submitted_at_idx" ON "service_request"("status", "kind", "submitted_at");

-- CreateIndex
CREATE INDEX "request_invitation_provider_org_id_status_created_at_idx" ON "request_invitation"("provider_org_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "request_invitation_request_id_provider_org_id_key" ON "request_invitation"("request_id", "provider_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "offer_invitation_id_key" ON "offer"("invitation_id");

-- CreateIndex
CREATE INDEX "offer_provider_org_id_status_idx" ON "offer"("provider_org_id", "status");

-- CreateIndex
CREATE INDEX "offer_request_id_idx" ON "offer"("request_id");

-- CreateIndex
CREATE INDEX "offer_version_request_id_status_idx" ON "offer_version"("request_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "offer_version_offer_id_version_no_key" ON "offer_version"("offer_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "booking_reference_key" ON "booking"("reference");

-- CreateIndex
CREATE INDEX "booking_customer_org_id_status_created_at_idx" ON "booking"("customer_org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "booking_provider_org_id_status_created_at_idx" ON "booking"("provider_org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "booking_technician_id_scheduled_start_idx" ON "booking"("technician_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "booking_request_id_idx" ON "booking"("request_id");

-- CreateIndex
CREATE INDEX "reschedule_proposal_booking_id_status_idx" ON "reschedule_proposal"("booking_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_reference_key" ON "work_order"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_booking_id_key" ON "work_order"("booking_id");

-- CreateIndex
CREATE INDEX "work_order_customer_org_id_status_idx" ON "work_order"("customer_org_id", "status");

-- CreateIndex
CREATE INDEX "work_order_provider_org_id_status_idx" ON "work_order"("provider_org_id", "status");

-- CreateIndex
CREATE INDEX "work_order_technician_id_status_idx" ON "work_order"("technician_id", "status");

-- CreateIndex
CREATE INDEX "work_order_equipment_id_idx" ON "work_order"("equipment_id");

-- CreateIndex
CREATE INDEX "job_event_booking_id_occurred_at_idx" ON "job_event"("booking_id", "occurred_at");

-- CreateIndex
CREATE INDEX "job_event_work_order_id_occurred_at_idx" ON "job_event"("work_order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "work_order_note_work_order_id_created_at_idx" ON "work_order_note"("work_order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "repair_quote_work_order_id_sequence_no_key" ON "repair_quote"("work_order_id", "sequence_no");

-- CreateIndex
CREATE INDEX "repair_quote_version_work_order_id_status_idx" ON "repair_quote_version"("work_order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "repair_quote_version_repair_quote_id_version_no_key" ON "repair_quote_version"("repair_quote_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "quote_line_item_version_id_position_key" ON "quote_line_item"("version_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "approval_version_id_key" ON "approval"("version_id");

-- CreateIndex
CREATE INDEX "approval_work_order_id_idx" ON "approval"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_report_work_order_id_key" ON "service_report"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_storage_key_key" ON "document"("storage_key");

-- CreateIndex
CREATE INDEX "document_owner_org_id_status_created_at_idx" ON "document"("owner_org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "document_request_id_idx" ON "document"("request_id");

-- CreateIndex
CREATE INDEX "document_work_order_id_idx" ON "document"("work_order_id");

-- CreateIndex
CREATE INDEX "document_status_created_at_idx" ON "document"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_record_booking_id_status_idx" ON "payment_record"("booking_id", "status");

-- CreateIndex
CREATE INDEX "payment_record_provider_org_id_status_idx" ON "payment_record"("provider_org_id", "status");

-- CreateIndex
CREATE INDEX "payment_record_customer_org_id_status_idx" ON "payment_record"("customer_org_id", "status");

-- CreateIndex
CREATE INDEX "payment_event_payment_id_created_at_idx" ON "payment_event"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "maintenance_plan_status_next_due_date_idx" ON "maintenance_plan"("status", "next_due_date");

-- CreateIndex
CREATE INDEX "maintenance_plan_customer_org_id_idx" ON "maintenance_plan"("customer_org_id");

-- CreateIndex
CREATE INDEX "maintenance_plan_provider_org_id_idx" ON "maintenance_plan"("provider_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_occurrence_occurrence_key_key" ON "maintenance_occurrence"("occurrence_key");

-- CreateIndex
CREATE INDEX "maintenance_occurrence_plan_id_due_date_idx" ON "maintenance_occurrence"("plan_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "review_booking_id_key" ON "review"("booking_id");

-- CreateIndex
CREATE INDEX "review_provider_org_id_status_idx" ON "review"("provider_org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_response_review_id_key" ON "review_response"("review_id");

-- CreateIndex
CREATE INDEX "dispute_status_created_at_idx" ON "dispute"("status", "created_at");

-- CreateIndex
CREATE INDEX "dispute_work_order_id_idx" ON "dispute"("work_order_id");

-- CreateIndex
CREATE INDEX "dispute_event_dispute_id_created_at_idx" ON "dispute_event"("dispute_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_code_key" ON "subscription_plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "provider_subscription_provider_org_id_key" ON "provider_subscription"("provider_org_id");

-- CreateIndex
CREATE INDEX "subscription_event_provider_org_id_created_at_idx" ON "subscription_event"("provider_org_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_referral_customer_org_id_created_at_idx" ON "provider_referral"("customer_org_id", "created_at");

-- CreateIndex
CREATE INDEX "support_message_handled_created_at_idx" ON "support_message"("handled", "created_at");

-- CreateIndex
CREATE INDEX "notification_user_id_organization_id_read_at_created_at_idx" ON "notification"("user_id", "organization_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_id_user_id_key" ON "notification"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "outbox_event_status_available_at_idx" ON "outbox_event"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_delivery_dedupe_key_key" ON "email_delivery"("dedupe_key");

-- CreateIndex
CREATE INDEX "email_delivery_status_available_at_idx" ON "email_delivery"("status", "available_at");

-- CreateIndex
CREATE INDEX "audit_event_target_type_target_id_idx" ON "audit_event"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_event_created_at_idx" ON "audit_event"("created_at");

-- CreateIndex
CREATE INDEX "audit_event_actor_org_id_created_at_idx" ON "audit_event"("actor_org_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_organization_id_operation_key_key" ON "idempotency_record"("organization_id", "operation", "key");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_category" ADD CONSTRAINT "equipment_category_service_category_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "service_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profile" ADD CONSTRAINT "provider_profile_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_service_area" ADD CONSTRAINT "provider_service_area_provider_profile_id_fkey" FOREIGN KEY ("provider_profile_id") REFERENCES "provider_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_service_area" ADD CONSTRAINT "provider_service_area_service_area_id_fkey" FOREIGN KEY ("service_area_id") REFERENCES "service_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_category" ADD CONSTRAINT "provider_category_provider_profile_id_fkey" FOREIGN KEY ("provider_profile_id") REFERENCES "provider_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_category" ADD CONSTRAINT "provider_category_equipment_category_id_fkey" FOREIGN KEY ("equipment_category_id") REFERENCES "equipment_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_check" ADD CONSTRAINT "provider_check_provider_profile_id_fkey" FOREIGN KEY ("provider_profile_id") REFERENCES "provider_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_skill" ADD CONSTRAINT "technician_skill_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technician_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_skill" ADD CONSTRAINT "technician_skill_equipment_category_id_fkey" FOREIGN KEY ("equipment_category_id") REFERENCES "equipment_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_window" ADD CONSTRAINT "availability_window_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technician_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technician_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reservation" ADD CONSTRAINT "appointment_reservation_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technician_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reservation" ADD CONSTRAINT "appointment_reservation_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_service_area_id_fkey" FOREIGN KEY ("service_area_id") REFERENCES "service_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "equipment_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_equipment_category_id_fkey" FOREIGN KEY ("equipment_category_id") REFERENCES "equipment_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_service_area_id_fkey" FOREIGN KEY ("service_area_id") REFERENCES "service_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_invitation" ADD CONSTRAINT "request_invitation_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer" ADD CONSTRAINT "offer_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer" ADD CONSTRAINT "offer_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "request_invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_version" ADD CONSTRAINT "offer_version_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_offer_version_id_fkey" FOREIGN KEY ("offer_version_id") REFERENCES "offer_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_proposal" ADD CONSTRAINT "reschedule_proposal_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_note" ADD CONSTRAINT "work_order_note_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_quote" ADD CONSTRAINT "repair_quote_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_quote_version" ADD CONSTRAINT "repair_quote_version_repair_quote_id_fkey" FOREIGN KEY ("repair_quote_id") REFERENCES "repair_quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_item" ADD CONSTRAINT "quote_line_item_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "repair_quote_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "repair_quote_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_occurrence" ADD CONSTRAINT "maintenance_occurrence_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "maintenance_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_response" ADD CONSTRAINT "review_response_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_event" ADD CONSTRAINT "dispute_event_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_subscription" ADD CONSTRAINT "provider_subscription_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "provider_subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
