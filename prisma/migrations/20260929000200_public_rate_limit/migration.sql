-- CreateTable
CREATE TABLE "public_rate_limit" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "public_rate_limit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "public_rate_limit_window_start_idx" ON "public_rate_limit"("window_start");

-- =============================================================================
-- Database-backed limiter for public endpoints (replaces the per-process in-memory limiter, so
-- the limit holds across several web instances and restarts).
--
-- The runtime role gets no table privileges: it can only call the trusted function below, which
-- increments a fixed-window counter atomically (INSERT … ON CONFLICT takes a row lock, so
-- concurrent requests are counted exactly). Keys are built by the application from an HMAC of
-- the client address; raw IP addresses are never stored.
-- =============================================================================

ALTER TABLE public_rate_limit ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app.hit_public_rate_limit(p_key text, p_max int, p_window_seconds int)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_count int;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR length(p_key) > 128 THEN
    RAISE EXCEPTION 'invalid rate-limit key' USING ERRCODE = '22023';
  END IF;
  IF p_max < 1 OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid rate-limit parameters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public_rate_limit AS r (key, window_start, count)
  VALUES (p_key, v_now, 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN r.window_start <= v_now - make_interval(secs => p_window_seconds) THEN 1 ELSE r.count + 1 END,
    window_start = CASE WHEN r.window_start <= v_now - make_interval(secs => p_window_seconds) THEN v_now ELSE r.window_start END
  RETURNING r.count INTO v_count;
  RETURN v_count > p_max;
END
$$;

REVOKE ALL ON FUNCTION app.hit_public_rate_limit(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.hit_public_rate_limit(text, int, int) TO mh_app;

-- The worker deletes windows that ended long ago.
GRANT SELECT, DELETE ON public_rate_limit TO mh_worker;
CREATE POLICY worker_cleanup ON public_rate_limit FOR ALL TO mh_worker USING (true);
