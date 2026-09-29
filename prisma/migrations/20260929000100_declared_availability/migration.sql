-- =============================================================================
-- Public "declared availability" filter for the provider directory.
--
-- Technician profiles, weekly availability windows and time off are private to the provider
-- (RLS). The public directory only needs a yes/no answer: "does this APPROVED provider declare
-- at least one active technician (with the requested equipment skill, if any) available on this
-- local date?" This trusted function returns that boolean and nothing else: no technician names,
-- hours, time-off reasons or reservations leave the provider's scope.
--
-- A weekly window counts as available unless a time-off period covers the whole window.
-- Existing reservations are deliberately ignored: this is declared, provisional availability,
-- confirmed only when the provider confirms a booking (which checks overlaps in the database).
-- =============================================================================

CREATE FUNCTION app.provider_declares_availability(p_provider_org text, p_date date, p_category text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT app.provider_is_public(p_provider_org) AND EXISTS (
    SELECT 1
    FROM technician_profile t
    JOIN availability_window w ON w.technician_id = t.id
    WHERE t.provider_org_id = p_provider_org
      AND t.active
      AND w.weekday = extract(isodow FROM p_date)::int
      AND (p_category IS NULL OR EXISTS (
            SELECT 1 FROM technician_skill s
            WHERE s.technician_id = t.id AND s.equipment_category_id = p_category))
      AND NOT EXISTS (
            SELECT 1 FROM time_off o
            WHERE o.technician_id = t.id
              AND o.starts_at <= ((p_date + make_interval(mins => w.start_minute)) AT TIME ZONE 'Africa/Casablanca')
              AND o.ends_at   >= ((p_date + make_interval(mins => w.end_minute)) AT TIME ZONE 'Africa/Casablanca'))
  )
$$;

REVOKE ALL ON FUNCTION app.provider_declares_availability(text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provider_declares_availability(text, date, text) TO mh_app;
