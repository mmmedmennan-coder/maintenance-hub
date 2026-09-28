-- =============================================================================
-- Maintenance Hub — integrity, isolation and privileges.
--
-- Hand-written (Prisma cannot express these objects). Sections:
--   1. Helper schema and trusted context functions
--   2. Organization/user foreign keys (generated list, reviewed)
--   3. Composite ownership keys (prevent cross-company relationships)
--   4. CHECK constraints, partial unique indexes, exclusion constraint
--   5. Immutability and state-transition triggers
--   6. Row-level security policies
--   7. Grants for runtime roles (mh_app, mh_auth, mh_worker)
--
-- Runtime roles never own tables and never have BYPASSRLS. The request context is
-- set per transaction by the server with set_config(..., true) from a verified
-- session: app.user_id and app.org_id. Every helper below re-validates membership
-- from the database, so a wrong or forged org id grants nothing.
-- =============================================================================

-- 1. Helper schema ------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO mh_app, mh_auth, mh_worker;

-- Current user id from the transaction-local context.
CREATE FUNCTION app.uid() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

-- Acting organization, only if the current user really is a member of it.
CREATE FUNCTION app.org() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m.organization_id FROM member m
  WHERE m.user_id = app.uid()
    AND m.organization_id = nullif(current_setting('app.org_id', true), '')
$$;

CREATE FUNCTION app.role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m.role FROM member m
  WHERE m.user_id = app.uid()
    AND m.organization_id = nullif(current_setting('app.org_id', true), '')
$$;

CREATE FUNCTION app.org_type() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT o.type::text FROM organization o WHERE o.id = app.org() $$;

CREATE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT coalesce(app.org_type() = 'PLATFORM' AND app.role() = 'platform_admin', false) $$;

CREATE FUNCTION app.is_customer_writer() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT coalesce(app.org_type() = 'CUSTOMER' AND app.role() IN ('customer_owner', 'customer_manager'), false) $$;

CREATE FUNCTION app.is_provider_manager() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT coalesce(app.org_type() = 'PROVIDER' AND app.role() IN ('provider_owner', 'provider_dispatcher'), false) $$;

CREATE FUNCTION app.is_technician() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT coalesce(app.org_type() = 'PROVIDER' AND app.role() = 'technician', false) $$;

-- Technician profile of the current user in the acting provider organization.
CREATE FUNCTION app.technician_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT t.id FROM technician_profile t
  WHERE t.user_id = app.uid() AND t.provider_org_id = app.org()
$$;

CREATE FUNCTION app.user_email() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT lower(u.email) FROM "user" u WHERE u.id = app.uid() $$;

-- Provider-side visibility of a booking-derived resource: managers see every booking
-- of their organization, technicians only the bookings assigned to them.
CREATE FUNCTION app.provider_sees_booking(p_provider_org text, p_technician text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_provider_org = app.org()
     AND (app.is_provider_manager() OR (app.is_technician() AND p_technician IS NOT NULL AND p_technician = app.technician_id()))
$$;

CREATE FUNCTION app.is_org_member(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM member m WHERE m.user_id = p_user AND m.organization_id = app.org()) $$;

CREATE FUNCTION app.provider_is_public(p_provider_org text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM provider_profile p WHERE p.provider_org_id = p_provider_org AND p.status = 'APPROVED') $$;

-- Customers keep seeing providers they worked with even if later suspended;
-- providers see a customer's name only once a booking exists (not at invitation stage).
CREATE FUNCTION app.can_see_org(p_org text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_org = app.org()
      OR app.is_admin()
      OR EXISTS (SELECT 1 FROM member m WHERE m.user_id = app.uid() AND m.organization_id = p_org)
      OR app.provider_is_public(p_org)
      OR EXISTS (SELECT 1 FROM request_invitation ri WHERE ri.provider_org_id = p_org AND ri.customer_org_id = app.org())
      OR EXISTS (SELECT 1 FROM booking b WHERE b.provider_org_id = p_org AND b.customer_org_id = app.org())
      OR EXISTS (SELECT 1 FROM booking b WHERE b.customer_org_id = p_org AND b.provider_org_id = app.org()
                   AND b.status NOT IN ('DECLINED', 'EXPIRED'))
$$;

-- Selected-provider access to a customer's request, site and equipment. Invited
-- providers never read these rows; they receive a limited brief on the invitation.
CREATE FUNCTION app.provider_can_see_request(p_request text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM booking b
    WHERE b.request_id = p_request AND b.status NOT IN ('DECLINED', 'EXPIRED')
      AND app.provider_sees_booking(b.provider_org_id, b.technician_id))
$$;

CREATE FUNCTION app.provider_can_see_site(p_site text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
      SELECT 1 FROM booking b
      WHERE b.site_id = p_site AND b.status NOT IN ('DECLINED', 'EXPIRED')
        AND app.provider_sees_booking(b.provider_org_id, b.technician_id))
    OR EXISTS (
      SELECT 1 FROM maintenance_plan mp
      WHERE mp.site_id = p_site AND mp.provider_org_id = app.org() AND app.is_provider_manager()
        AND mp.status IN ('PROPOSED', 'ACTIVE', 'PAUSED'))
$$;

CREATE FUNCTION app.provider_can_see_equipment(p_equipment text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
      SELECT 1 FROM booking b
      WHERE b.equipment_id = p_equipment AND b.status NOT IN ('DECLINED', 'EXPIRED')
        AND app.provider_sees_booking(b.provider_org_id, b.technician_id))
    OR EXISTS (
      SELECT 1 FROM maintenance_plan mp
      WHERE mp.equipment_id = p_equipment AND mp.provider_org_id = app.org() AND app.is_provider_manager()
        AND mp.status IN ('PROPOSED', 'ACTIVE', 'PAUSED'))
$$;

-- Invited (and still active) provider for a request: may read quoting attachments.
CREATE FUNCTION app.is_request_invitee(p_request text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT app.is_provider_manager() AND EXISTS (
    SELECT 1 FROM request_invitation ri
    WHERE ri.request_id = p_request AND ri.provider_org_id = app.org()
      AND ri.status IN ('INVITED', 'OFFERED'))
$$;

CREATE FUNCTION app.can_see_work_order(p_work_order text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM work_order w
    WHERE w.id = p_work_order
      AND (w.customer_org_id = app.org() OR app.provider_sees_booking(w.provider_org_id, w.technician_id)))
$$;

-- Operational counters for the admin dashboard (counts only; never message bodies).
CREATE FUNCTION app.queue_health()
RETURNS TABLE (outbox_pending int, outbox_failed int, outbox_dead int, email_failed int, email_dead int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*)::int FROM outbox_event WHERE status IN ('PENDING', 'PROCESSING')),
    (SELECT count(*)::int FROM outbox_event WHERE status = 'FAILED'),
    (SELECT count(*)::int FROM outbox_event WHERE status = 'DEAD'),
    (SELECT count(*)::int FROM email_delivery WHERE status = 'FAILED'),
    (SELECT count(*)::int FROM email_delivery WHERE status = 'DEAD')
  WHERE app.is_admin()
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO mh_app, mh_worker, mh_auth;


-- 2. Organization and user foreign keys ---------------------------------------------

ALTER TABLE "provider_profile" ADD CONSTRAINT "provider_profile_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_service_area" ADD CONSTRAINT "provider_service_area_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_category" ADD CONSTRAINT "provider_category_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_check" ADD CONSTRAINT "provider_check_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_check" ADD CONSTRAINT "provider_check_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technician_profile" ADD CONSTRAINT "technician_profile_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technician_profile" ADD CONSTRAINT "technician_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technician_skill" ADD CONSTRAINT "technician_skill_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "availability_window" ADD CONSTRAINT "availability_window_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_reservation" ADD CONSTRAINT "appointment_reservation_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_reservation" ADD CONSTRAINT "appointment_reservation_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "site" ADD CONSTRAINT "site_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_invitation" ADD CONSTRAINT "request_invitation_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_invitation" ADD CONSTRAINT "request_invitation_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_invitation" ADD CONSTRAINT "request_invitation_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer" ADD CONSTRAINT "offer_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer" ADD CONSTRAINT "offer_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer" ADD CONSTRAINT "offer_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_version" ADD CONSTRAINT "offer_version_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_version" ADD CONSTRAINT "offer_version_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_version" ADD CONSTRAINT "offer_version_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_version" ADD CONSTRAINT "offer_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_selected_by_id_fkey" FOREIGN KEY ("selected_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking" ADD CONSTRAINT "booking_no_show_reported_by_id_fkey" FOREIGN KEY ("no_show_reported_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reschedule_proposal" ADD CONSTRAINT "reschedule_proposal_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reschedule_proposal" ADD CONSTRAINT "reschedule_proposal_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reschedule_proposal" ADD CONSTRAINT "reschedule_proposal_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reschedule_proposal" ADD CONSTRAINT "reschedule_proposal_responded_by_id_fkey" FOREIGN KEY ("responded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_actor_org_id_fkey" FOREIGN KEY ("actor_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order_note" ADD CONSTRAINT "work_order_note_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order_note" ADD CONSTRAINT "work_order_note_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order_note" ADD CONSTRAINT "work_order_note_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order_note" ADD CONSTRAINT "work_order_note_author_org_id_fkey" FOREIGN KEY ("author_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_quote" ADD CONSTRAINT "repair_quote_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_quote" ADD CONSTRAINT "repair_quote_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_quote" ADD CONSTRAINT "repair_quote_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_quote_version" ADD CONSTRAINT "repair_quote_version_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_quote_version" ADD CONSTRAINT "repair_quote_version_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_quote_version" ADD CONSTRAINT "repair_quote_version_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_quote_version" ADD CONSTRAINT "repair_quote_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line_item" ADD CONSTRAINT "quote_line_item_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line_item" ADD CONSTRAINT "quote_line_item_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval" ADD CONSTRAINT "approval_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval" ADD CONSTRAINT "approval_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval" ADD CONSTRAINT "approval_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval" ADD CONSTRAINT "approval_actor_org_id_fkey" FOREIGN KEY ("actor_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document" ADD CONSTRAINT "document_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document" ADD CONSTRAINT "document_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document" ADD CONSTRAINT "document_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_reported_by_org_id_fkey" FOREIGN KEY ("reported_by_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_actor_org_id_fkey" FOREIGN KEY ("actor_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_consented_by_id_fkey" FOREIGN KEY ("consented_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_occurrence" ADD CONSTRAINT "maintenance_occurrence_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_occurrence" ADD CONSTRAINT "maintenance_occurrence_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_moderated_by_id_fkey" FOREIGN KEY ("moderated_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_response" ADD CONSTRAINT "review_response_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_response" ADD CONSTRAINT "review_response_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_response" ADD CONSTRAINT "review_response_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_event" ADD CONSTRAINT "dispute_event_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_event" ADD CONSTRAINT "dispute_event_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_event" ADD CONSTRAINT "dispute_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_event" ADD CONSTRAINT "dispute_event_actor_org_id_fkey" FOREIGN KEY ("actor_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_subscription" ADD CONSTRAINT "provider_subscription_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_provider_org_id_fkey" FOREIGN KEY ("provider_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_referral" ADD CONSTRAINT "provider_referral_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_referral" ADD CONSTRAINT "provider_referral_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_actor_org_id_fkey" FOREIGN KEY ("actor_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_org_id_fkey" FOREIGN KEY ("actor_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Composite ownership keys --------------------------------------------------
-- A child row repeats its owning organization(s); composite foreign keys make it
-- impossible to attach another customer's asset or another provider's technician.

ALTER TABLE site ADD CONSTRAINT site_id_customer_key UNIQUE (id, customer_org_id);
ALTER TABLE equipment ADD CONSTRAINT equipment_id_customer_key UNIQUE (id, customer_org_id);
ALTER TABLE equipment ADD CONSTRAINT equipment_id_site_key UNIQUE (id, site_id);
ALTER TABLE equipment ADD CONSTRAINT equipment_site_owner_fkey
  FOREIGN KEY (site_id, customer_org_id) REFERENCES site (id, customer_org_id);

ALTER TABLE provider_profile ADD CONSTRAINT provider_profile_id_org_key UNIQUE (id, provider_org_id);
ALTER TABLE provider_service_area ADD CONSTRAINT provider_service_area_owner_fkey
  FOREIGN KEY (provider_profile_id, provider_org_id) REFERENCES provider_profile (id, provider_org_id) ON DELETE CASCADE;
ALTER TABLE provider_category ADD CONSTRAINT provider_category_owner_fkey
  FOREIGN KEY (provider_profile_id, provider_org_id) REFERENCES provider_profile (id, provider_org_id) ON DELETE CASCADE;
ALTER TABLE provider_check ADD CONSTRAINT provider_check_owner_fkey
  FOREIGN KEY (provider_profile_id, provider_org_id) REFERENCES provider_profile (id, provider_org_id) ON DELETE CASCADE;

ALTER TABLE technician_profile ADD CONSTRAINT technician_profile_id_org_key UNIQUE (id, provider_org_id);
ALTER TABLE technician_skill ADD CONSTRAINT technician_skill_owner_fkey
  FOREIGN KEY (technician_id, provider_org_id) REFERENCES technician_profile (id, provider_org_id) ON DELETE CASCADE;
ALTER TABLE availability_window ADD CONSTRAINT availability_window_owner_fkey
  FOREIGN KEY (technician_id, provider_org_id) REFERENCES technician_profile (id, provider_org_id) ON DELETE CASCADE;
ALTER TABLE time_off ADD CONSTRAINT time_off_owner_fkey
  FOREIGN KEY (technician_id, provider_org_id) REFERENCES technician_profile (id, provider_org_id) ON DELETE CASCADE;

ALTER TABLE service_request ADD CONSTRAINT service_request_id_customer_key UNIQUE (id, customer_org_id);
ALTER TABLE service_request ADD CONSTRAINT service_request_site_owner_fkey
  FOREIGN KEY (site_id, customer_org_id) REFERENCES site (id, customer_org_id);
ALTER TABLE service_request ADD CONSTRAINT service_request_equipment_owner_fkey
  FOREIGN KEY (equipment_id, customer_org_id) REFERENCES equipment (id, customer_org_id);
ALTER TABLE service_request ADD CONSTRAINT service_request_equipment_site_fkey
  FOREIGN KEY (equipment_id, site_id) REFERENCES equipment (id, site_id);

ALTER TABLE request_invitation ADD CONSTRAINT request_invitation_request_owner_fkey
  FOREIGN KEY (request_id, customer_org_id) REFERENCES service_request (id, customer_org_id);
ALTER TABLE request_invitation ADD CONSTRAINT request_invitation_parties_key
  UNIQUE (id, request_id, customer_org_id, provider_org_id);

ALTER TABLE offer ADD CONSTRAINT offer_invitation_parties_fkey
  FOREIGN KEY (invitation_id, request_id, customer_org_id, provider_org_id)
  REFERENCES request_invitation (id, request_id, customer_org_id, provider_org_id);
ALTER TABLE offer ADD CONSTRAINT offer_parties_key UNIQUE (id, request_id, customer_org_id, provider_org_id);

ALTER TABLE offer_version ADD CONSTRAINT offer_version_offer_parties_fkey
  FOREIGN KEY (offer_id, request_id, customer_org_id, provider_org_id)
  REFERENCES offer (id, request_id, customer_org_id, provider_org_id);
ALTER TABLE offer_version ADD CONSTRAINT offer_version_parties_key
  UNIQUE (id, offer_id, request_id, customer_org_id, provider_org_id);

ALTER TABLE booking ADD CONSTRAINT booking_offer_version_parties_fkey
  FOREIGN KEY (offer_version_id, offer_id, request_id, customer_org_id, provider_org_id)
  REFERENCES offer_version (id, offer_id, request_id, customer_org_id, provider_org_id);
ALTER TABLE booking ADD CONSTRAINT booking_site_owner_fkey
  FOREIGN KEY (site_id, customer_org_id) REFERENCES site (id, customer_org_id);
ALTER TABLE booking ADD CONSTRAINT booking_equipment_owner_fkey
  FOREIGN KEY (equipment_id, customer_org_id) REFERENCES equipment (id, customer_org_id);
ALTER TABLE booking ADD CONSTRAINT booking_equipment_site_fkey
  FOREIGN KEY (equipment_id, site_id) REFERENCES equipment (id, site_id);
ALTER TABLE booking ADD CONSTRAINT booking_technician_owner_fkey
  FOREIGN KEY (technician_id, provider_org_id) REFERENCES technician_profile (id, provider_org_id);
ALTER TABLE booking ADD CONSTRAINT booking_parties_key UNIQUE (id, customer_org_id, provider_org_id);
ALTER TABLE booking ADD CONSTRAINT booking_provider_key UNIQUE (id, provider_org_id);

ALTER TABLE appointment_reservation ADD CONSTRAINT appointment_reservation_booking_owner_fkey
  FOREIGN KEY (booking_id, provider_org_id) REFERENCES booking (id, provider_org_id);
ALTER TABLE appointment_reservation ADD CONSTRAINT appointment_reservation_technician_owner_fkey
  FOREIGN KEY (technician_id, provider_org_id) REFERENCES technician_profile (id, provider_org_id);

ALTER TABLE reschedule_proposal ADD CONSTRAINT reschedule_proposal_booking_parties_fkey
  FOREIGN KEY (booking_id, customer_org_id, provider_org_id) REFERENCES booking (id, customer_org_id, provider_org_id);
ALTER TABLE reschedule_proposal ADD CONSTRAINT reschedule_proposal_technician_owner_fkey
  FOREIGN KEY (technician_id, provider_org_id) REFERENCES technician_profile (id, provider_org_id);

ALTER TABLE work_order ADD CONSTRAINT work_order_booking_parties_fkey
  FOREIGN KEY (booking_id, customer_org_id, provider_org_id) REFERENCES booking (id, customer_org_id, provider_org_id);
ALTER TABLE work_order ADD CONSTRAINT work_order_technician_owner_fkey
  FOREIGN KEY (technician_id, provider_org_id) REFERENCES technician_profile (id, provider_org_id);
ALTER TABLE work_order ADD CONSTRAINT work_order_equipment_owner_fkey
  FOREIGN KEY (equipment_id, customer_org_id) REFERENCES equipment (id, customer_org_id);
ALTER TABLE work_order ADD CONSTRAINT work_order_site_owner_fkey
  FOREIGN KEY (site_id, customer_org_id) REFERENCES site (id, customer_org_id);
ALTER TABLE work_order ADD CONSTRAINT work_order_parties_key UNIQUE (id, customer_org_id, provider_org_id);

ALTER TABLE job_event ADD CONSTRAINT job_event_booking_parties_fkey
  FOREIGN KEY (booking_id, customer_org_id, provider_org_id) REFERENCES booking (id, customer_org_id, provider_org_id);
ALTER TABLE job_event ADD CONSTRAINT job_event_work_order_parties_fkey
  FOREIGN KEY (work_order_id, customer_org_id, provider_org_id) REFERENCES work_order (id, customer_org_id, provider_org_id);
ALTER TABLE work_order_note ADD CONSTRAINT work_order_note_parties_fkey
  FOREIGN KEY (work_order_id, customer_org_id, provider_org_id) REFERENCES work_order (id, customer_org_id, provider_org_id);

ALTER TABLE repair_quote ADD CONSTRAINT repair_quote_work_order_parties_fkey
  FOREIGN KEY (work_order_id, customer_org_id, provider_org_id) REFERENCES work_order (id, customer_org_id, provider_org_id);
ALTER TABLE repair_quote ADD CONSTRAINT repair_quote_parties_key UNIQUE (id, work_order_id, customer_org_id, provider_org_id);
ALTER TABLE repair_quote_version ADD CONSTRAINT repair_quote_version_quote_parties_fkey
  FOREIGN KEY (repair_quote_id, work_order_id, customer_org_id, provider_org_id)
  REFERENCES repair_quote (id, work_order_id, customer_org_id, provider_org_id);
ALTER TABLE repair_quote_version ADD CONSTRAINT repair_quote_version_parties_key
  UNIQUE (id, repair_quote_id, work_order_id, customer_org_id, provider_org_id);
ALTER TABLE repair_quote_version ADD CONSTRAINT repair_quote_version_id_parties_key
  UNIQUE (id, customer_org_id, provider_org_id);
ALTER TABLE quote_line_item ADD CONSTRAINT quote_line_item_version_parties_fkey
  FOREIGN KEY (version_id, customer_org_id, provider_org_id) REFERENCES repair_quote_version (id, customer_org_id, provider_org_id);
ALTER TABLE approval ADD CONSTRAINT approval_version_parties_fkey
  FOREIGN KEY (version_id, repair_quote_id, work_order_id, customer_org_id, provider_org_id)
  REFERENCES repair_quote_version (id, repair_quote_id, work_order_id, customer_org_id, provider_org_id);

ALTER TABLE service_report ADD CONSTRAINT service_report_work_order_parties_fkey
  FOREIGN KEY (work_order_id, customer_org_id, provider_org_id) REFERENCES work_order (id, customer_org_id, provider_org_id);

ALTER TABLE payment_record ADD CONSTRAINT payment_record_booking_parties_fkey
  FOREIGN KEY (booking_id, customer_org_id, provider_org_id) REFERENCES booking (id, customer_org_id, provider_org_id);
ALTER TABLE payment_record ADD CONSTRAINT payment_record_parties_key UNIQUE (id, booking_id, customer_org_id, provider_org_id);
ALTER TABLE payment_event ADD CONSTRAINT payment_event_payment_parties_fkey
  FOREIGN KEY (payment_id, booking_id, customer_org_id, provider_org_id)
  REFERENCES payment_record (id, booking_id, customer_org_id, provider_org_id);

ALTER TABLE maintenance_plan ADD CONSTRAINT maintenance_plan_equipment_owner_fkey
  FOREIGN KEY (equipment_id, customer_org_id) REFERENCES equipment (id, customer_org_id);
ALTER TABLE maintenance_plan ADD CONSTRAINT maintenance_plan_equipment_site_fkey
  FOREIGN KEY (equipment_id, site_id) REFERENCES equipment (id, site_id);
ALTER TABLE maintenance_plan ADD CONSTRAINT maintenance_plan_parties_key UNIQUE (id, customer_org_id, provider_org_id);
ALTER TABLE maintenance_occurrence ADD CONSTRAINT maintenance_occurrence_plan_parties_fkey
  FOREIGN KEY (plan_id, customer_org_id, provider_org_id) REFERENCES maintenance_plan (id, customer_org_id, provider_org_id);
ALTER TABLE maintenance_occurrence ADD CONSTRAINT maintenance_occurrence_draft_request_fkey
  FOREIGN KEY (draft_request_id, customer_org_id) REFERENCES service_request (id, customer_org_id);
ALTER TABLE service_request ADD CONSTRAINT service_request_plan_fkey
  FOREIGN KEY (maintenance_plan_id) REFERENCES maintenance_plan (id);

ALTER TABLE review ADD CONSTRAINT review_booking_parties_fkey
  FOREIGN KEY (booking_id, customer_org_id, provider_org_id) REFERENCES booking (id, customer_org_id, provider_org_id);
ALTER TABLE review ADD CONSTRAINT review_parties_key UNIQUE (id, customer_org_id, provider_org_id);
ALTER TABLE review_response ADD CONSTRAINT review_response_review_parties_fkey
  FOREIGN KEY (review_id, customer_org_id, provider_org_id) REFERENCES review (id, customer_org_id, provider_org_id);

ALTER TABLE dispute ADD CONSTRAINT dispute_work_order_parties_fkey
  FOREIGN KEY (work_order_id, customer_org_id, provider_org_id) REFERENCES work_order (id, customer_org_id, provider_org_id);
ALTER TABLE dispute ADD CONSTRAINT dispute_booking_parties_fkey
  FOREIGN KEY (booking_id, customer_org_id, provider_org_id) REFERENCES booking (id, customer_org_id, provider_org_id);
ALTER TABLE dispute ADD CONSTRAINT dispute_parties_key UNIQUE (id, customer_org_id, provider_org_id);
ALTER TABLE dispute_event ADD CONSTRAINT dispute_event_dispute_parties_fkey
  FOREIGN KEY (dispute_id, customer_org_id, provider_org_id) REFERENCES dispute (id, customer_org_id, provider_org_id);

ALTER TABLE provider_subscription ADD CONSTRAINT provider_subscription_id_org_key UNIQUE (id, provider_org_id);
ALTER TABLE subscription_event ADD CONSTRAINT subscription_event_owner_fkey
  FOREIGN KEY (subscription_id, provider_org_id) REFERENCES provider_subscription (id, provider_org_id);

-- Documents: relationship columns must agree with the parties.
ALTER TABLE document ADD CONSTRAINT document_request_owner_fkey
  FOREIGN KEY (request_id, customer_org_id) REFERENCES service_request (id, customer_org_id);
ALTER TABLE document ADD CONSTRAINT document_work_order_parties_fkey
  FOREIGN KEY (work_order_id, customer_org_id, provider_org_id) REFERENCES work_order (id, customer_org_id, provider_org_id);
ALTER TABLE document ADD CONSTRAINT document_equipment_owner_fkey
  FOREIGN KEY (equipment_id, customer_org_id) REFERENCES equipment (id, customer_org_id);
ALTER TABLE document ADD CONSTRAINT document_report_fkey
  FOREIGN KEY (report_id) REFERENCES service_report (id);
ALTER TABLE document ADD CONSTRAINT document_payment_parties_fkey
  FOREIGN KEY (payment_id) REFERENCES payment_record (id);
ALTER TABLE document ADD CONSTRAINT document_quote_version_fkey
  FOREIGN KEY (repair_quote_version_id, customer_org_id, provider_org_id)
  REFERENCES repair_quote_version (id, customer_org_id, provider_org_id);
ALTER TABLE payment_record ADD CONSTRAINT payment_record_evidence_fkey
  FOREIGN KEY (evidence_document_id) REFERENCES document (id);
ALTER TABLE document ADD CONSTRAINT document_owner_is_party_check CHECK (
  (customer_org_id IS NULL AND provider_org_id IS NULL)
  OR owner_org_id = customer_org_id OR owner_org_id = provider_org_id);
ALTER TABLE document ADD CONSTRAINT document_relations_have_parties_check CHECK (
  (request_id IS NULL OR customer_org_id IS NOT NULL)
  AND (equipment_id IS NULL OR customer_org_id IS NOT NULL)
  AND (work_order_id IS NULL OR (customer_org_id IS NOT NULL AND provider_org_id IS NOT NULL))
  AND (repair_quote_version_id IS NULL OR (customer_org_id IS NOT NULL AND provider_org_id IS NOT NULL))
  AND (visibility <> 'QUOTING_SHARED' OR request_id IS NOT NULL)
  AND (visibility <> 'SHARED_PARTIES' OR (customer_org_id IS NOT NULL AND provider_org_id IS NOT NULL)));

-- 4. Value checks, partial unique indexes, exclusion constraint -----------------

ALTER TABLE member ADD CONSTRAINT member_role_check CHECK (role IN (
  'customer_owner', 'customer_manager', 'customer_viewer',
  'provider_owner', 'provider_dispatcher', 'technician', 'platform_admin'));
ALTER TABLE invitation ADD CONSTRAINT invitation_role_check CHECK (role IS NULL OR role IN (
  'customer_owner', 'customer_manager', 'customer_viewer',
  'provider_owner', 'provider_dispatcher', 'technician'));

ALTER TABLE availability_window ADD CONSTRAINT availability_window_range_check
  CHECK (weekday BETWEEN 1 AND 7 AND start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);
ALTER TABLE time_off ADD CONSTRAINT time_off_range_check CHECK (starts_at < ends_at);
ALTER TABLE appointment_reservation ADD CONSTRAINT appointment_reservation_range_check CHECK (
  starts_at < ends_at AND blocked_start <= starts_at AND ends_at <= blocked_end
  AND buffer_before_min BETWEEN 0 AND 240 AND buffer_after_min BETWEEN 0 AND 240
  AND blocked_start = starts_at - make_interval(mins => buffer_before_min)
  AND blocked_end = ends_at + make_interval(mins => buffer_after_min));
ALTER TABLE appointment_reservation ADD CONSTRAINT appointment_reservation_no_overlap
  EXCLUDE USING gist (technician_id WITH =, tstzrange(blocked_start, blocked_end, '[)') WITH &&)
  WHERE (status = 'ACTIVE');
CREATE UNIQUE INDEX appointment_reservation_one_active_per_booking
  ON appointment_reservation (booking_id) WHERE status = 'ACTIVE';
ALTER TABLE reschedule_proposal ADD CONSTRAINT reschedule_proposal_range_check CHECK (starts_at < ends_at);
CREATE UNIQUE INDEX reschedule_proposal_one_pending ON reschedule_proposal (booking_id) WHERE status = 'PENDING';

ALTER TABLE offer_version ADD CONSTRAINT offer_version_values_check CHECK (
  version_no >= 1
  AND coalesce(callout_fee_minor, 0) >= 0 AND coalesce(service_fee_minor, 0) >= 0
  AND (tax_rate_bp IS NULL OR tax_rate_bp BETWEEN 0 AND 10000)
  AND subtotal_minor >= 0 AND tax_minor >= 0 AND total_minor = subtotal_minor + tax_minor
  AND currency ~ '^[A-Z]{3}$'
  AND (window_start IS NULL OR window_end IS NULL OR window_start < window_end)
  AND (estimated_duration_min IS NULL OR estimated_duration_min BETWEEN 15 AND 1440));
ALTER TABLE offer_version ADD CONSTRAINT offer_version_issued_complete_check CHECK (
  status = 'DRAFT' OR (
    issued_at IS NOT NULL AND issued_by_id IS NOT NULL AND snapshot_hash IS NOT NULL
    AND service_fee_minor IS NOT NULL AND tax_rate_bp IS NOT NULL
    AND window_start IS NOT NULL AND window_end IS NOT NULL
    AND estimated_duration_min IS NOT NULL AND expires_at IS NOT NULL AND cancellation_terms IS NOT NULL));
CREATE UNIQUE INDEX offer_version_one_draft ON offer_version (offer_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX offer_version_one_issued ON offer_version (offer_id) WHERE status = 'ISSUED';

-- One active booking per request (pending, confirmed or completed).
CREATE UNIQUE INDEX booking_one_active_per_request
  ON booking (request_id) WHERE status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'COMPLETED');
ALTER TABLE booking ADD CONSTRAINT booking_values_check CHECK (
  (scheduled_start IS NULL) = (scheduled_end IS NULL)
  AND (scheduled_start IS NULL OR scheduled_start < scheduled_end)
  AND (status NOT IN ('CONFIRMED', 'COMPLETED') OR (technician_id IS NOT NULL AND scheduled_start IS NOT NULL)));

ALTER TABLE repair_quote_version ADD CONSTRAINT repair_quote_version_values_check CHECK (
  version_no >= 1 AND subtotal_minor >= 0 AND tax_minor >= 0 AND total_minor = subtotal_minor + tax_minor
  AND currency ~ '^[A-Z]{3}$'
  AND (status = 'DRAFT' OR (issued_at IS NOT NULL AND issued_by_id IS NOT NULL AND snapshot_hash IS NOT NULL)));
CREATE UNIQUE INDEX repair_quote_version_one_draft ON repair_quote_version (repair_quote_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX repair_quote_version_one_issued ON repair_quote_version (repair_quote_id) WHERE status = 'ISSUED';
ALTER TABLE quote_line_item ADD CONSTRAINT quote_line_item_values_check CHECK (
  quantity_milli > 0 AND quantity_milli <= 100000000 AND unit_price_minor >= 0
  AND tax_rate_bp BETWEEN 0 AND 10000 AND subtotal_minor >= 0 AND tax_minor >= 0
  AND total_minor = subtotal_minor + tax_minor AND position >= 1);
ALTER TABLE approval ADD CONSTRAINT approval_values_check CHECK (amount_minor >= 0 AND currency ~ '^[A-Z]{3}$');

ALTER TABLE payment_record ADD CONSTRAINT payment_record_values_check CHECK (
  amount_minor > 0 AND currency ~ '^[A-Z]{3}$'
  AND (status <> 'CONFIRMED' OR (confirmed_by_id IS NOT NULL AND confirmed_at IS NOT NULL))
  AND (status <> 'REVERSED' OR (reversed_by_id IS NOT NULL AND reversal_reason IS NOT NULL))
  AND (status <> 'REJECTED' OR rejected_by_id IS NOT NULL));

ALTER TABLE maintenance_plan ADD CONSTRAINT maintenance_plan_values_check CHECK (
  interval_months BETWEEN 1 AND 60 AND reminder_lead_days BETWEEN 0 AND 90);
ALTER TABLE review ADD CONSTRAINT review_rating_check CHECK (rating BETWEEN 1 AND 5);
-- Generated PDFs: at most one live document per report / issued quote version (worker retries are idempotent).
CREATE UNIQUE INDEX document_one_report_pdf ON document (report_id) WHERE kind = 'REPORT_PDF' AND status <> 'DELETED';
CREATE UNIQUE INDEX document_one_quote_pdf ON document (repair_quote_version_id) WHERE kind = 'QUOTE_PDF' AND status <> 'DELETED';
CREATE UNIQUE INDEX dispute_one_open_per_work_order
  ON dispute (work_order_id) WHERE status IN ('OPEN', 'UNDER_REVIEW');
ALTER TABLE subscription_plan ADD CONSTRAINT subscription_plan_values_check CHECK (
  price_minor >= 0 AND max_staff BETWEEN 1 AND 100 AND currency ~ '^[A-Z]{3}$');
ALTER TABLE subscription_event ADD CONSTRAINT subscription_event_values_check CHECK (
  (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)
  AND (amount_minor IS NULL OR amount_minor >= 0));
ALTER TABLE document ADD CONSTRAINT document_size_check CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 15728640);
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_attempts_check CHECK (attempts >= 0);
ALTER TABLE email_delivery ADD CONSTRAINT email_delivery_attempts_check CHECK (attempts >= 0);


-- 5. Immutability and state-transition triggers ---------------------------------
-- SQLSTATE MH001 = invalid transition, MH002 = immutable record, MH003 = not permitted.
-- Application services validate first; these triggers are the last line of defence.

CREATE FUNCTION app.trg_member_role() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE org_type text;
BEGIN
  SELECT o.type::text INTO org_type FROM organization o WHERE o.id = NEW.organization_id;
  IF (org_type = 'CUSTOMER' AND NEW.role NOT IN ('customer_owner', 'customer_manager', 'customer_viewer'))
     OR (org_type = 'PROVIDER' AND NEW.role NOT IN ('provider_owner', 'provider_dispatcher', 'technician'))
     OR (org_type = 'PLATFORM' AND NEW.role <> 'platform_admin') THEN
    RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = format('role %s is not valid for a %s organization', NEW.role, coalesce(org_type, 'unknown'));
  END IF;
  -- Platform administrators are created only by the documented setup command (owner connection).
  IF NEW.role = 'platform_admin' AND session_user <> 'mh_owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = 'platform_admin memberships can only be created by the setup command';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER member_role_guard BEFORE INSERT OR UPDATE OF role, organization_id ON member
  FOR EACH ROW EXECUTE FUNCTION app.trg_member_role();

CREATE FUNCTION app.trg_invitation_role() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE org_type text;
BEGIN
  SELECT o.type::text INTO org_type FROM organization o WHERE o.id = NEW.organization_id;
  IF NEW.role IS NOT NULL AND (
       (org_type = 'CUSTOMER' AND NEW.role NOT IN ('customer_owner', 'customer_manager', 'customer_viewer'))
    OR (org_type = 'PROVIDER' AND NEW.role NOT IN ('provider_owner', 'provider_dispatcher', 'technician'))
    OR org_type = 'PLATFORM') THEN
    RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = 'invitation role does not match organization type';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invitation_role_guard BEFORE INSERT OR UPDATE OF role, organization_id ON invitation
  FOR EACH ROW EXECUTE FUNCTION app.trg_invitation_role();

CREATE FUNCTION app.trg_provider_profile_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF session_user = 'mh_owner' OR app.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_by_id IS NOT NULL OR NEW.is_demo THEN
      RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = 'new provider profiles start as DRAFT';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.provider_org_id <> OLD.provider_org_id OR NEW.slug <> OLD.slug OR NEW.is_demo <> OLD.is_demo
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.reviewed_by_id IS DISTINCT FROM OLD.reviewed_by_id
     OR NEW.status_reason IS DISTINCT FROM OLD.status_reason THEN
    RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = 'review fields can only be changed by a platform administrator';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status IN ('DRAFT', 'REJECTED') AND NEW.status = 'SUBMITTED') THEN
    RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = format('provider status %s -> %s requires an administrator', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_profile_guard BEFORE INSERT OR UPDATE ON provider_profile
  FOR EACH ROW EXECUTE FUNCTION app.trg_provider_profile_guard();

CREATE FUNCTION app.trg_service_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND ROW(NEW.customer_org_id, NEW.site_id, NEW.equipment_id, NEW.equipment_category_id,
       NEW.service_area_id, NEW.city, NEW.kind, NEW.title, NEW.symptoms, NEW.preferred_windows, NEW.source, NEW.created_by_id)
     IS DISTINCT FROM ROW(OLD.customer_org_id, OLD.site_id, OLD.equipment_id, OLD.equipment_category_id,
       OLD.service_area_id, OLD.city, OLD.kind, OLD.title, OLD.symptoms, OLD.preferred_windows, OLD.source, OLD.created_by_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'a submitted request cannot be edited';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('OPEN', 'CANCELLED'))
    OR (OLD.status = 'OPEN' AND NEW.status IN ('BOOKING', 'CANCELLED'))
    OR (OLD.status = 'BOOKING' AND NEW.status IN ('OPEN', 'CLOSED', 'CANCELLED'))) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = format('request %s -> %s is not allowed', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_request_guard BEFORE UPDATE ON service_request
  FOR EACH ROW EXECUTE FUNCTION app.trg_service_request_guard();

CREATE FUNCTION app.trg_offer_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'issued offer versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND ROW(NEW.offer_id, NEW.request_id, NEW.customer_org_id, NEW.provider_org_id, NEW.version_no,
       NEW.kind, NEW.scope, NEW.callout_fee_minor, NEW.service_fee_minor, NEW.tax_rate_bp, NEW.tax_note, NEW.currency,
       NEW.subtotal_minor, NEW.tax_minor, NEW.total_minor, NEW.window_start, NEW.window_end, NEW.estimated_duration_min,
       NEW.exclusions, NEW.cancellation_terms, NEW.warranty_terms, NEW.expires_at, NEW.snapshot_hash, NEW.issued_at, NEW.issued_by_id)
     IS DISTINCT FROM ROW(OLD.offer_id, OLD.request_id, OLD.customer_org_id, OLD.provider_org_id, OLD.version_no,
       OLD.kind, OLD.scope, OLD.callout_fee_minor, OLD.service_fee_minor, OLD.tax_rate_bp, OLD.tax_note, OLD.currency,
       OLD.subtotal_minor, OLD.tax_minor, OLD.total_minor, OLD.window_start, OLD.window_end, OLD.estimated_duration_min,
       OLD.exclusions, OLD.cancellation_terms, OLD.warranty_terms, OLD.expires_at, OLD.snapshot_hash, OLD.issued_at, OLD.issued_by_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'issued offer versions are immutable; create a revision';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'ISSUED')
    OR (OLD.status = 'ISSUED' AND NEW.status IN ('SUPERSEDED', 'WITHDRAWN', 'SELECTED', 'NOT_SELECTED', 'EXPIRED'))
    OR (OLD.status = 'SELECTED' AND NEW.status IN ('RELEASED'))) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = format('offer version %s -> %s is not allowed', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offer_version_guard BEFORE UPDATE OR DELETE ON offer_version
  FOR EACH ROW EXECUTE FUNCTION app.trg_offer_version_guard();

CREATE FUNCTION app.trg_booking_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.request_id, NEW.offer_id, NEW.offer_version_id, NEW.customer_org_id, NEW.provider_org_id, NEW.site_id, NEW.equipment_id, NEW.kind)
     IS DISTINCT FROM ROW(OLD.request_id, OLD.offer_id, OLD.offer_version_id, OLD.customer_org_id, OLD.provider_org_id, OLD.site_id, OLD.equipment_id, OLD.kind) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'booking parties and accepted offer are immutable';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING_CONFIRMATION' AND NEW.status IN ('CONFIRMED', 'DECLINED', 'EXPIRED', 'CANCELLED'))
    OR (OLD.status = 'CONFIRMED' AND NEW.status IN ('CANCELLED', 'NO_SHOW', 'COMPLETED'))) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = format('booking %s -> %s is not allowed', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_guard BEFORE UPDATE ON booking
  FOR EACH ROW EXECUTE FUNCTION app.trg_booking_guard();

CREATE FUNCTION app.trg_work_order_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(NEW.booking_id, NEW.customer_org_id, NEW.provider_org_id, NEW.site_id, NEW.equipment_id, NEW.kind, NEW.maintenance_scope_authorized)
     IS DISTINCT FROM ROW(OLD.booking_id, OLD.customer_org_id, OLD.provider_org_id, OLD.site_id, OLD.equipment_id, OLD.kind, OLD.maintenance_scope_authorized) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'work order parties are immutable';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'SCHEDULED' AND NEW.status IN ('EN_ROUTE', 'ON_SITE', 'CANCELLED'))
      OR (OLD.status = 'EN_ROUTE' AND NEW.status IN ('ON_SITE', 'CANCELLED'))
      OR (OLD.status = 'ON_SITE' AND NEW.status IN ('AWAITING_APPROVAL', 'IN_PROGRESS', 'REPORT_SUBMITTED'))
      OR (OLD.status = 'AWAITING_APPROVAL' AND NEW.status IN ('DIAGNOSED'))
      OR (OLD.status = 'DIAGNOSED' AND NEW.status IN ('AWAITING_APPROVAL', 'IN_PROGRESS', 'AWAITING_PARTS', 'REPORT_SUBMITTED'))
      OR (OLD.status = 'AWAITING_PARTS' AND NEW.status IN ('AWAITING_APPROVAL', 'IN_PROGRESS', 'REPORT_SUBMITTED'))
      OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_APPROVAL', 'AWAITING_PARTS', 'REPORT_SUBMITTED'))) THEN
      RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = format('work order %s -> %s is not allowed', OLD.status, NEW.status);
    END IF;
    -- Work may only start (or wait for parts) within an authorized scope.
    IF NEW.status IN ('IN_PROGRESS', 'AWAITING_PARTS') AND NOT NEW.maintenance_scope_authorized
       AND NOT EXISTS (SELECT 1 FROM repair_quote_version v WHERE v.work_order_id = NEW.id AND v.status = 'APPROVED') THEN
      RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = 'an approved scope is required before work starts';
    END IF;
    -- A report cannot be submitted while a repair quote awaits the customer's decision.
    IF NEW.status = 'REPORT_SUBMITTED'
       AND EXISTS (SELECT 1 FROM repair_quote_version v WHERE v.work_order_id = NEW.id AND v.status = 'ISSUED') THEN
      RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = 'a repair quote is still awaiting a decision';
    END IF;
  END IF;
  IF NEW.acknowledgment IS DISTINCT FROM OLD.acknowledgment AND NOT (
       (OLD.acknowledgment IS NULL AND NEW.acknowledgment = 'PENDING' AND NEW.status = 'REPORT_SUBMITTED')
    OR (OLD.acknowledgment = 'PENDING' AND NEW.acknowledgment IN ('ACKNOWLEDGED', 'DISPUTED'))
    OR (OLD.acknowledgment = 'DISPUTED' AND NEW.acknowledgment = 'ACKNOWLEDGED')) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = 'invalid acknowledgment change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_order_guard BEFORE UPDATE ON work_order
  FOR EACH ROW EXECUTE FUNCTION app.trg_work_order_guard();

CREATE FUNCTION app.trg_repair_quote_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'issued repair quotes cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND ROW(NEW.repair_quote_id, NEW.work_order_id, NEW.customer_org_id, NEW.provider_org_id, NEW.version_no,
       NEW.scope_summary, NEW.estimated_duration_min, NEW.timing_note, NEW.exclusions, NEW.warranty_terms, NEW.valid_until,
       NEW.revision_reason, NEW.currency, NEW.subtotal_minor, NEW.tax_minor, NEW.total_minor, NEW.snapshot_hash, NEW.issued_at, NEW.issued_by_id)
     IS DISTINCT FROM ROW(OLD.repair_quote_id, OLD.work_order_id, OLD.customer_org_id, OLD.provider_org_id, OLD.version_no,
       OLD.scope_summary, OLD.estimated_duration_min, OLD.timing_note, OLD.exclusions, OLD.warranty_terms, OLD.valid_until,
       OLD.revision_reason, OLD.currency, OLD.subtotal_minor, OLD.tax_minor, OLD.total_minor, OLD.snapshot_hash, OLD.issued_at, OLD.issued_by_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'issued repair quotes are immutable; create a revision';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'ISSUED')
      OR (OLD.status = 'ISSUED' AND NEW.status IN ('SUPERSEDED', 'APPROVED', 'REJECTED', 'WITHDRAWN'))) THEN
      RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = format('repair quote %s -> %s is not allowed', OLD.status, NEW.status);
    END IF;
    IF NEW.status IN ('APPROVED', 'REJECTED') AND NOT EXISTS (
         SELECT 1 FROM approval a WHERE a.version_id = NEW.id AND a.decision::text = NEW.status::text) THEN
      RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = 'a customer decision record is required';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER repair_quote_version_guard BEFORE UPDATE OR DELETE ON repair_quote_version
  FOR EACH ROW EXECUTE FUNCTION app.trg_repair_quote_version_guard();

CREATE FUNCTION app.trg_quote_line_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE v_status text;
BEGIN
  SELECT v.status::text INTO v_status FROM repair_quote_version v
  WHERE v.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'lines can only change while the quote is a draft';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id <> OLD.version_id THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'lines cannot move between versions';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER quote_line_guard BEFORE INSERT OR UPDATE OR DELETE ON quote_line_item
  FOR EACH ROW EXECUTE FUNCTION app.trg_quote_line_guard();

-- An approval must capture exactly the issued version's amount and snapshot hash.
CREATE FUNCTION app.trg_approval_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE v record;
BEGIN
  SELECT status::text AS status, total_minor, currency, snapshot_hash INTO v
  FROM repair_quote_version WHERE id = NEW.version_id;
  IF v.status IS DISTINCT FROM 'ISSUED' THEN
    RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = 'only an issued repair quote can be decided';
  END IF;
  IF NEW.amount_minor <> v.total_minor OR NEW.currency <> v.currency OR NEW.snapshot_hash <> v.snapshot_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'decision does not match the issued quote';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_guard BEFORE INSERT ON approval
  FOR EACH ROW EXECUTE FUNCTION app.trg_approval_guard();

CREATE FUNCTION app.trg_payment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE b_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status::text INTO b_status FROM booking WHERE id = NEW.booking_id;
    IF b_status NOT IN ('CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') THEN
      RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = 'payments can only be recorded for a confirmed appointment';
    END IF;
    IF NEW.status NOT IN ('REPORTED', 'CONFIRMED') THEN
      RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = 'a new payment record is REPORTED or CONFIRMED';
    END IF;
    IF NEW.status = 'CONFIRMED' AND NEW.reported_by_org_id <> NEW.provider_org_id AND session_user <> 'mh_owner' THEN
      RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = 'only the payee can record a confirmed receipt';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.booking_id, NEW.customer_org_id, NEW.provider_org_id, NEW.amount_minor, NEW.currency, NEW.method, NEW.paid_on,
         NEW.reported_side, NEW.reported_by_id, NEW.reported_by_org_id, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.booking_id, OLD.customer_org_id, OLD.provider_org_id, OLD.amount_minor, OLD.currency, OLD.method, OLD.paid_on,
         OLD.reported_side, OLD.reported_by_id, OLD.reported_by_org_id, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = 'MH002', MESSAGE = 'payment facts are immutable; record a reversal instead';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'REPORTED' AND NEW.status IN ('CONFIRMED', 'REJECTED'))
         OR (OLD.status = 'CONFIRMED' AND NEW.status = 'REVERSED')) THEN
      RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = format('payment %s -> %s is not allowed', OLD.status, NEW.status);
    END IF;
    IF session_user <> 'mh_owner' AND NOT (app.org() = NEW.provider_org_id OR app.is_admin()) THEN
      RAISE EXCEPTION USING ERRCODE = 'MH003', MESSAGE = 'only the payee (or an administrator) can change a payment status';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_guard BEFORE INSERT OR UPDATE ON payment_record
  FOR EACH ROW EXECUTE FUNCTION app.trg_payment_guard();

CREATE FUNCTION app.trg_review_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM booking b WHERE b.id = NEW.booking_id AND b.status = 'COMPLETED') THEN
    RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = 'reviews require a completed booking';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER review_guard BEFORE INSERT ON review
  FOR EACH ROW EXECUTE FUNCTION app.trg_review_guard();

CREATE FUNCTION app.trg_dispute_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_order w WHERE w.id = NEW.work_order_id AND w.status = 'REPORT_SUBMITTED') THEN
    RAISE EXCEPTION USING ERRCODE = 'MH001', MESSAGE = 'a dispute requires a submitted report';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dispute_guard BEFORE INSERT ON dispute
  FOR EACH ROW EXECUTE FUNCTION app.trg_dispute_guard();


-- 6. Row-level security ------------------------------------------------------------
-- Identity-only tables (session, account, verification, rate_limit) have no RLS:
-- only mh_auth holds privileges on them. Every other table has RLS enabled.

ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE member ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_area ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_service_area ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_skill ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE site ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking ENABLE ROW LEVEL SECURITY;
ALTER TABLE reschedule_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_quote ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_quote_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE document ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_occurrence ENABLE ROW LEVEL SECURITY;
ALTER TABLE review ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_referral ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_record ENABLE ROW LEVEL SECURITY;

-- 6a. Identity tables -----------------------------------------------------------------
CREATE POLICY auth_all ON "user" TO mh_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON organization TO mh_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON member TO mh_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON invitation TO mh_auth USING (true) WITH CHECK (true);

CREATE POLICY app_read ON "user" FOR SELECT TO mh_app
  USING (id = (SELECT app.uid()) OR (SELECT app.is_admin()) OR app.is_org_member(id));
CREATE POLICY app_read ON organization FOR SELECT TO mh_app
  USING (app.can_see_org(id));
CREATE POLICY app_read ON member FOR SELECT TO mh_app
  USING (user_id = (SELECT app.uid()) OR organization_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_read ON invitation FOR SELECT TO mh_app
  USING ((organization_id = (SELECT app.org()) AND ((SELECT app.is_customer_writer()) OR (SELECT app.is_provider_manager())))
         OR lower(email) = (SELECT app.user_email()) OR (SELECT app.is_admin()));

CREATE POLICY worker_read ON "user" FOR SELECT TO mh_worker USING (true);
CREATE POLICY worker_read ON organization FOR SELECT TO mh_worker USING (true);
CREATE POLICY worker_read ON member FOR SELECT TO mh_worker USING (true);

-- 6b. Reference data (public read, administrator write) --------------------------------
CREATE POLICY public_read ON service_category FOR SELECT TO mh_app, mh_worker USING (true);
CREATE POLICY admin_write ON service_category FOR INSERT TO mh_app WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY admin_update ON service_category FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));
CREATE POLICY public_read ON equipment_category FOR SELECT TO mh_app, mh_worker USING (true);
CREATE POLICY admin_write ON equipment_category FOR INSERT TO mh_app WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY admin_update ON equipment_category FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));
CREATE POLICY public_read ON service_area FOR SELECT TO mh_app, mh_worker USING (true);
CREATE POLICY admin_write ON service_area FOR INSERT TO mh_app WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY admin_update ON service_area FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));
CREATE POLICY public_read ON subscription_plan FOR SELECT TO mh_app, mh_auth, mh_worker USING (true);
CREATE POLICY admin_write ON subscription_plan FOR INSERT TO mh_app WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY admin_update ON subscription_plan FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));

-- 6c. Providers --------------------------------------------------------------------------
CREATE POLICY app_read ON provider_profile FOR SELECT TO mh_app
  USING (status = 'APPROVED' OR provider_org_id = (SELECT app.org()) OR app.can_see_org(provider_org_id));
CREATE POLICY app_insert ON provider_profile FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY app_update ON provider_profile FOR UPDATE TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager())) OR (SELECT app.is_admin()));
CREATE POLICY worker_read ON provider_profile FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON provider_service_area FOR SELECT TO mh_app
  USING (provider_org_id = (SELECT app.org()) OR app.provider_is_public(provider_org_id) OR (SELECT app.is_admin()));
CREATE POLICY app_write ON provider_service_area FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY app_delete ON provider_service_area FOR DELETE TO mh_app
  USING (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY app_read ON provider_category FOR SELECT TO mh_app
  USING (provider_org_id = (SELECT app.org()) OR app.provider_is_public(provider_org_id) OR (SELECT app.is_admin()));
CREATE POLICY app_write ON provider_category FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY app_delete ON provider_category FOR DELETE TO mh_app
  USING (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));

-- Public projections select only type/status/public_note; internal_note is admin-only by convention
-- in the service layer, and rows other than VERIFIED ones are hidden from the public.
CREATE POLICY app_read ON provider_check FOR SELECT TO mh_app
  USING ((SELECT app.is_admin()) OR provider_org_id = (SELECT app.org())
         OR (status = 'VERIFIED' AND app.provider_is_public(provider_org_id)));
CREATE POLICY admin_insert ON provider_check FOR INSERT TO mh_app WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY admin_update ON provider_check FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));

CREATE POLICY app_read ON technician_profile FOR SELECT TO mh_app
  USING (provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON technician_profile FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org())
              AND ((SELECT app.is_provider_manager()) OR ((SELECT app.is_technician()) AND user_id = (SELECT app.uid()))));
CREATE POLICY app_update ON technician_profile FOR UPDATE TO mh_app
  USING (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY worker_read ON technician_profile FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON technician_skill FOR SELECT TO mh_app
  USING (provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON technician_skill FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY app_delete ON technician_skill FOR DELETE TO mh_app
  USING (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));

CREATE POLICY app_read ON availability_window FOR SELECT TO mh_app
  USING (provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON availability_window FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY app_delete ON availability_window FOR DELETE TO mh_app
  USING (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));

CREATE POLICY app_read ON time_off FOR SELECT TO mh_app
  USING (provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON time_off FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY app_delete ON time_off FOR DELETE TO mh_app
  USING (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));

-- Reservations: written by the provider on confirmation, or by either party when an
-- accepted reschedule atomically replaces the slot of their own booking.
CREATE POLICY app_read ON appointment_reservation FOR SELECT TO mh_app
  USING (provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin())
         OR EXISTS (SELECT 1 FROM booking b WHERE b.id = booking_id AND b.customer_org_id = (SELECT app.org())));
CREATE POLICY app_insert ON appointment_reservation FOR INSERT TO mh_app
  WITH CHECK ((provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
              OR ((SELECT app.is_customer_writer())
                  AND EXISTS (SELECT 1 FROM booking b WHERE b.id = booking_id AND b.customer_org_id = (SELECT app.org()))));
CREATE POLICY app_update ON appointment_reservation FOR UPDATE TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR ((SELECT app.is_customer_writer())
             AND EXISTS (SELECT 1 FROM booking b WHERE b.id = booking_id AND b.customer_org_id = (SELECT app.org())))
         OR (SELECT app.is_admin()));
CREATE POLICY worker_all ON appointment_reservation TO mh_worker USING (true) WITH CHECK (true);

-- 6d. Customer assets ---------------------------------------------------------------------
CREATE POLICY app_read ON site FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR (SELECT app.is_admin()) OR app.provider_can_see_site(id));
CREATE POLICY app_insert ON site FOR INSERT TO mh_app
  WITH CHECK (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()));
CREATE POLICY app_update ON site FOR UPDATE TO mh_app
  USING (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()));
CREATE POLICY worker_read ON site FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON equipment FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR (SELECT app.is_admin()) OR app.provider_can_see_equipment(id));
CREATE POLICY app_insert ON equipment FOR INSERT TO mh_app
  WITH CHECK (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()));
CREATE POLICY app_update ON equipment FOR UPDATE TO mh_app
  USING (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()));
CREATE POLICY worker_read ON equipment FOR SELECT TO mh_worker USING (true);

-- 6e. Requests, invitations, offers ---------------------------------------------------------
CREATE POLICY app_read ON service_request FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR (SELECT app.is_admin()) OR app.provider_can_see_request(id));
CREATE POLICY app_insert ON service_request FOR INSERT TO mh_app
  WITH CHECK (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()) AND created_by_id = (SELECT app.uid()));
CREATE POLICY app_update ON service_request FOR UPDATE TO mh_app
  USING (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()));
CREATE POLICY worker_all ON service_request TO mh_worker USING (true) WITH CHECK (true);

CREATE POLICY app_read ON request_invitation FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org())
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON request_invitation FOR INSERT TO mh_app
  WITH CHECK (((customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer())) OR (SELECT app.is_admin()))
              AND invited_by_id = (SELECT app.uid()));
CREATE POLICY app_update ON request_invitation FOR UPDATE TO mh_app
  USING ((customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (SELECT app.is_admin()));
CREATE POLICY worker_all ON request_invitation TO mh_worker USING (true) WITH CHECK (true);

CREATE POLICY app_read ON offer FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org())
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON offer FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()) AND created_by_id = (SELECT app.uid()));
CREATE POLICY app_update ON offer FOR UPDATE TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer())));
CREATE POLICY worker_all ON offer TO mh_worker USING (true) WITH CHECK (true);

-- Customers never see drafts; providers never see other providers' offers.
CREATE POLICY app_read ON offer_version FOR SELECT TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (customer_org_id = (SELECT app.org()) AND status <> 'DRAFT')
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_technician())
             AND EXISTS (SELECT 1 FROM booking b WHERE b.offer_version_id = offer_version.id AND b.technician_id = (SELECT app.technician_id())))
         OR ((SELECT app.is_admin()) AND status <> 'DRAFT'));
CREATE POLICY app_insert ON offer_version FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()) AND status = 'DRAFT');
CREATE POLICY app_update ON offer_version FOR UPDATE TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()) AND status <> 'DRAFT'));
CREATE POLICY app_delete ON offer_version FOR DELETE TO mh_app
  USING (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()) AND status = 'DRAFT');
CREATE POLICY worker_all ON offer_version TO mh_worker USING (true) WITH CHECK (true);

-- 6f. Bookings and work -----------------------------------------------------------------
CREATE POLICY app_read ON booking FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR app.provider_sees_booking(provider_org_id, technician_id) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON booking FOR INSERT TO mh_app
  WITH CHECK (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer())
              AND status = 'PENDING_CONFIRMATION' AND selected_by_id = (SELECT app.uid()));
-- Assigned technicians may update their booking (report submission completes it);
-- which transitions each role may perform is decided by the service layer and the guard trigger.
CREATE POLICY app_update ON booking FOR UPDATE TO mh_app
  USING ((customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))
         OR app.provider_sees_booking(provider_org_id, technician_id)
         OR (SELECT app.is_admin()));
CREATE POLICY worker_all ON booking TO mh_worker USING (true) WITH CHECK (true);

CREATE POLICY app_read ON reschedule_proposal FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON reschedule_proposal FOR INSERT TO mh_app
  WITH CHECK (proposed_by_id = (SELECT app.uid()) AND (
    (proposed_by_side = 'CUSTOMER' AND customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))
    OR (proposed_by_side = 'PROVIDER' AND provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))));
CREATE POLICY app_update ON reschedule_proposal FOR UPDATE TO mh_app
  USING ((customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager())));

CREATE POLICY app_read ON work_order FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR app.provider_sees_booking(provider_org_id, technician_id) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON work_order FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()));
CREATE POLICY app_update ON work_order FOR UPDATE TO mh_app
  USING ((customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))
         OR app.provider_sees_booking(provider_org_id, technician_id)
         OR (SELECT app.is_admin()));
CREATE POLICY worker_read ON work_order FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON job_event FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR (SELECT app.is_admin())
         OR EXISTS (SELECT 1 FROM booking b WHERE b.id = booking_id AND app.provider_sees_booking(b.provider_org_id, b.technician_id)));
CREATE POLICY app_insert ON job_event FOR INSERT TO mh_app
  WITH CHECK (actor_user_id = (SELECT app.uid()) AND actor_org_id = (SELECT app.org())
              AND (customer_org_id = (SELECT app.org()) OR provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin())));
CREATE POLICY worker_all ON job_event TO mh_worker USING (true) WITH CHECK (true);

CREATE POLICY app_read ON work_order_note FOR SELECT TO mh_app
  USING (((SELECT app.is_admin()) AND visibility = 'SHARED')
      OR (visibility = 'SHARED' AND (customer_org_id = (SELECT app.org()) OR app.can_see_work_order(work_order_id)))
      OR (visibility = 'PROVIDER_INTERNAL' AND provider_org_id = (SELECT app.org()) AND app.can_see_work_order(work_order_id))
      OR (visibility = 'CUSTOMER_PRIVATE' AND customer_org_id = (SELECT app.org())));
CREATE POLICY app_insert ON work_order_note FOR INSERT TO mh_app
  WITH CHECK (author_user_id = (SELECT app.uid()) AND author_org_id = (SELECT app.org()) AND (
       (visibility IN ('SHARED', 'PROVIDER_INTERNAL') AND provider_org_id = (SELECT app.org()) AND app.can_see_work_order(work_order_id))
    OR (visibility IN ('SHARED', 'CUSTOMER_PRIVATE') AND customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))));

CREATE POLICY app_read ON repair_quote FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR app.can_see_work_order(work_order_id) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON repair_quote FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND app.can_see_work_order(work_order_id) AND created_by_id = (SELECT app.uid()));
CREATE POLICY worker_read ON repair_quote FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON repair_quote_version FOR SELECT TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND app.can_see_work_order(work_order_id))
         OR (customer_org_id = (SELECT app.org()) AND status <> 'DRAFT')
         OR ((SELECT app.is_admin()) AND status <> 'DRAFT'));
CREATE POLICY app_insert ON repair_quote_version FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND app.can_see_work_order(work_order_id) AND status = 'DRAFT');
CREATE POLICY app_update ON repair_quote_version FOR UPDATE TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND app.can_see_work_order(work_order_id))
         OR (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()) AND status <> 'DRAFT'));
CREATE POLICY app_delete ON repair_quote_version FOR DELETE TO mh_app
  USING (provider_org_id = (SELECT app.org()) AND app.can_see_work_order(work_order_id) AND status = 'DRAFT');
CREATE POLICY worker_read ON repair_quote_version FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON quote_line_item FOR SELECT TO mh_app
  USING (EXISTS (SELECT 1 FROM repair_quote_version v WHERE v.id = version_id));
CREATE POLICY app_insert ON quote_line_item FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org())
              AND EXISTS (SELECT 1 FROM repair_quote_version v WHERE v.id = version_id AND app.can_see_work_order(v.work_order_id)));
CREATE POLICY app_update ON quote_line_item FOR UPDATE TO mh_app
  USING (provider_org_id = (SELECT app.org())
         AND EXISTS (SELECT 1 FROM repair_quote_version v WHERE v.id = version_id AND app.can_see_work_order(v.work_order_id)));
CREATE POLICY app_delete ON quote_line_item FOR DELETE TO mh_app
  USING (provider_org_id = (SELECT app.org())
         AND EXISTS (SELECT 1 FROM repair_quote_version v WHERE v.id = version_id AND app.can_see_work_order(v.work_order_id)));
CREATE POLICY worker_read ON quote_line_item FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON approval FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR app.can_see_work_order(work_order_id) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON approval FOR INSERT TO mh_app
  WITH CHECK (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer())
              AND actor_user_id = (SELECT app.uid()) AND actor_org_id = (SELECT app.org()));
CREATE POLICY worker_read ON approval FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON service_report FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR app.can_see_work_order(work_order_id) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON service_report FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND app.can_see_work_order(work_order_id) AND submitted_by_id = (SELECT app.uid()));
CREATE POLICY worker_read ON service_report FOR SELECT TO mh_worker USING (true);

-- 6g. Documents -------------------------------------------------------------------------
CREATE POLICY app_read ON document FOR SELECT TO mh_app
  USING (
    (owner_org_id = (SELECT app.org())
      AND (NOT (SELECT app.is_technician()) OR uploaded_by_id = (SELECT app.uid())
           OR (work_order_id IS NOT NULL AND app.can_see_work_order(work_order_id))))
    OR (visibility = 'SHARED_PARTIES' AND status = 'READY' AND (
         customer_org_id = (SELECT app.org())
         OR (work_order_id IS NOT NULL AND app.can_see_work_order(work_order_id))
         OR (work_order_id IS NULL AND provider_org_id = (SELECT app.org()) AND NOT (SELECT app.is_technician()))))
    OR (visibility = 'QUOTING_SHARED' AND status = 'READY' AND request_id IS NOT NULL
        AND (app.is_request_invitee(request_id) OR app.provider_can_see_request(request_id)))
    OR ((SELECT app.is_admin()) AND visibility <> 'OWNER_ONLY'));
CREATE POLICY app_insert ON document FOR INSERT TO mh_app
  WITH CHECK (owner_org_id = (SELECT app.org()) AND uploaded_by_id = (SELECT app.uid())
              AND coalesce((SELECT app.role()), '') <> 'customer_viewer');
CREATE POLICY app_update ON document FOR UPDATE TO mh_app
  USING (owner_org_id = (SELECT app.org()) AND (uploaded_by_id = (SELECT app.uid()) OR NOT (SELECT app.is_technician())));
CREATE POLICY worker_all ON document TO mh_worker USING (true) WITH CHECK (true);

-- 6h. Payments (technicians have no access to company finance) -------------------------------
CREATE POLICY app_read ON payment_record FOR SELECT TO mh_app
  USING ((customer_org_id = (SELECT app.org()) OR (provider_org_id = (SELECT app.org()) AND NOT (SELECT app.is_technician())))
         OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON payment_record FOR INSERT TO mh_app
  WITH CHECK (reported_by_id = (SELECT app.uid()) AND reported_by_org_id = (SELECT app.org()) AND (
       (reported_side = 'CUSTOMER' AND status = 'REPORTED' AND customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))
    OR (reported_side = 'PROVIDER' AND status = 'CONFIRMED' AND provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))));
-- Customers cannot update payment records at all: a payer can never confirm its own report.
CREATE POLICY app_update ON payment_record FOR UPDATE TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager())) OR (SELECT app.is_admin()));

CREATE POLICY app_read ON payment_event FOR SELECT TO mh_app
  USING ((customer_org_id = (SELECT app.org()) OR (provider_org_id = (SELECT app.org()) AND NOT (SELECT app.is_technician())))
         OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON payment_event FOR INSERT TO mh_app
  WITH CHECK (actor_user_id = (SELECT app.uid()) AND actor_org_id = (SELECT app.org())
              AND (customer_org_id = (SELECT app.org()) OR provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin())));

-- 6i. Maintenance plans ---------------------------------------------------------------------
CREATE POLICY app_read ON maintenance_plan FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org())
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON maintenance_plan FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager())
              AND status = 'PROPOSED' AND proposed_by_id = (SELECT app.uid()));
CREATE POLICY app_update ON maintenance_plan FOR UPDATE TO mh_app
  USING ((customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager())));
CREATE POLICY worker_all ON maintenance_plan TO mh_worker USING (true) WITH CHECK (true);

CREATE POLICY app_read ON maintenance_occurrence FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org())
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (SELECT app.is_admin()));
CREATE POLICY app_update ON maintenance_occurrence FOR UPDATE TO mh_app
  USING (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()));
CREATE POLICY worker_all ON maintenance_occurrence TO mh_worker USING (true) WITH CHECK (true);

-- 6j. Reviews and disputes -------------------------------------------------------------------
CREATE POLICY app_read ON review FOR SELECT TO mh_app
  USING (status = 'PUBLISHED' OR customer_org_id = (SELECT app.org()) OR provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON review FOR INSERT TO mh_app
  WITH CHECK (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer())
              AND author_user_id = (SELECT app.uid()) AND status = 'PENDING_MODERATION' AND NOT is_demo);
CREATE POLICY admin_update ON review FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));
CREATE POLICY worker_read ON review FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON review_response FOR SELECT TO mh_app
  USING ((NOT hidden AND EXISTS (SELECT 1 FROM review r WHERE r.id = review_id AND r.status = 'PUBLISHED'))
         OR provider_org_id = (SELECT app.org()) OR customer_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON review_response FOR INSERT TO mh_app
  WITH CHECK (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()) AND author_user_id = (SELECT app.uid()) AND NOT hidden);
CREATE POLICY admin_update ON review_response FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));

CREATE POLICY app_read ON dispute FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org())
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON dispute FOR INSERT TO mh_app
  WITH CHECK (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()) AND opened_by_id = (SELECT app.uid()));
CREATE POLICY app_update ON dispute FOR UPDATE TO mh_app
  USING ((customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer())) OR (SELECT app.is_admin()));
CREATE POLICY worker_read ON dispute FOR SELECT TO mh_worker USING (true);
CREATE POLICY worker_read ON payment_record FOR SELECT TO mh_worker USING (true);
CREATE POLICY worker_read ON reschedule_proposal FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON dispute_event FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org())
         OR (provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
         OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON dispute_event FOR INSERT TO mh_app
  WITH CHECK (actor_user_id = (SELECT app.uid()) AND actor_org_id = (SELECT app.org()) AND (
       (actor_side = 'CUSTOMER' AND customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()))
    OR (actor_side = 'PROVIDER' AND provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager()))
    OR (actor_side = 'PLATFORM' AND (SELECT app.is_admin()))));

-- 6k. Subscriptions -------------------------------------------------------------------------
CREATE POLICY app_read ON provider_subscription FOR SELECT TO mh_app
  USING (provider_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY admin_insert ON provider_subscription FOR INSERT TO mh_app WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY admin_update ON provider_subscription FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));
CREATE POLICY auth_read ON provider_subscription FOR SELECT TO mh_auth USING (true);
CREATE POLICY worker_read ON provider_subscription FOR SELECT TO mh_worker USING (true);

CREATE POLICY app_read ON subscription_event FOR SELECT TO mh_app
  USING ((provider_org_id = (SELECT app.org()) AND (SELECT app.is_provider_manager())) OR (SELECT app.is_admin()));
CREATE POLICY admin_insert ON subscription_event FOR INSERT TO mh_app
  WITH CHECK ((SELECT app.is_admin()) AND actor_user_id = (SELECT app.uid()));

-- 6l. Referrals, support, notifications, infrastructure ----------------------------------------
CREATE POLICY app_read ON provider_referral FOR SELECT TO mh_app
  USING (customer_org_id = (SELECT app.org()) OR (SELECT app.is_admin()));
CREATE POLICY app_insert ON provider_referral FOR INSERT TO mh_app
  WITH CHECK (customer_org_id = (SELECT app.org()) AND (SELECT app.is_customer_writer()) AND invited_by_id = (SELECT app.uid()));

CREATE POLICY anyone_insert ON support_message FOR INSERT TO mh_app
  WITH CHECK (user_id IS NULL OR user_id = (SELECT app.uid()));
CREATE POLICY admin_read ON support_message FOR SELECT TO mh_app USING ((SELECT app.is_admin()));
CREATE POLICY admin_update ON support_message FOR UPDATE TO mh_app USING ((SELECT app.is_admin()));

CREATE POLICY own_read ON notification FOR SELECT TO mh_app USING (user_id = (SELECT app.uid()));
CREATE POLICY own_update ON notification FOR UPDATE TO mh_app USING (user_id = (SELECT app.uid()));
CREATE POLICY worker_all ON notification TO mh_worker USING (true) WITH CHECK (true);

CREATE POLICY app_insert ON outbox_event FOR INSERT TO mh_app
  WITH CHECK (actor_user_id IS NULL OR actor_user_id = (SELECT app.uid()));
CREATE POLICY worker_all ON outbox_event TO mh_worker USING (true) WITH CHECK (true);

CREATE POLICY app_insert ON email_delivery FOR INSERT TO mh_app, mh_auth WITH CHECK (true);
CREATE POLICY worker_all ON email_delivery TO mh_worker USING (true) WITH CHECK (true);

CREATE POLICY app_insert ON audit_event FOR INSERT TO mh_app
  WITH CHECK (actor_user_id IS NULL OR actor_user_id = (SELECT app.uid()));
CREATE POLICY other_insert ON audit_event FOR INSERT TO mh_auth, mh_worker WITH CHECK (true);
CREATE POLICY admin_read ON audit_event FOR SELECT TO mh_app USING ((SELECT app.is_admin()));

CREATE POLICY own_all ON idempotency_record TO mh_app
  USING (organization_id = (SELECT app.org()))
  WITH CHECK (organization_id = (SELECT app.org()) AND user_id = (SELECT app.uid()));

-- 7. Privileges ----------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

-- Better Auth runtime: identity tables only.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, rate_limit, organization, member, invitation TO mh_auth;
GRANT SELECT ON subscription_plan, provider_subscription TO mh_auth;
GRANT INSERT ON email_delivery, audit_event TO mh_auth;

-- Web runtime.
GRANT SELECT ON "user", organization, member, invitation TO mh_app;
GRANT SELECT, INSERT, UPDATE ON service_category, equipment_category, service_area, subscription_plan,
  provider_profile, provider_check, technician_profile, appointment_reservation, site, equipment,
  service_request, request_invitation, offer, booking, reschedule_proposal, work_order,
  repair_quote_version, document, payment_record, maintenance_plan, review, review_response, dispute,
  provider_subscription TO mh_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON offer_version, quote_line_item TO mh_app;
GRANT DELETE ON repair_quote_version TO mh_app;
GRANT SELECT, INSERT, DELETE ON provider_service_area, provider_category, technician_skill, availability_window, time_off TO mh_app;
GRANT SELECT, INSERT, UPDATE ON idempotency_record TO mh_app;
GRANT SELECT, INSERT ON job_event, work_order_note, repair_quote, approval, service_report, payment_event, dispute_event,
  subscription_event, provider_referral TO mh_app;
GRANT SELECT, UPDATE ON maintenance_occurrence TO mh_app;
GRANT SELECT ON notification TO mh_app;
GRANT UPDATE (read_at) ON notification TO mh_app;
GRANT INSERT ON outbox_event, email_delivery, audit_event TO mh_app;
GRANT SELECT ON audit_event TO mh_app;
GRANT SELECT, INSERT, UPDATE ON support_message TO mh_app;

-- Worker.
GRANT SELECT, UPDATE ON outbox_event, email_delivery TO mh_worker;
GRANT SELECT, INSERT ON notification, email_delivery TO mh_worker;
GRANT SELECT ON "user", organization, member, provider_profile, technician_profile, site, equipment,
  equipment_category, service_area, work_order, repair_quote, repair_quote_version, quote_line_item, approval,
  service_report, dispute, review, subscription_plan, provider_subscription, appointment_reservation TO mh_worker;
GRANT SELECT, INSERT, UPDATE ON service_request, request_invitation, offer, offer_version, booking, document,
  maintenance_plan, maintenance_occurrence TO mh_worker;
GRANT SELECT, INSERT ON job_event TO mh_worker;
GRANT UPDATE ON appointment_reservation TO mh_worker;
GRANT INSERT ON audit_event TO mh_worker;
GRANT SELECT ON payment_record, reschedule_proposal TO mh_worker;

GRANT USAGE ON SEQUENCE request_ref_seq, booking_ref_seq, work_order_ref_seq TO mh_app, mh_worker;
