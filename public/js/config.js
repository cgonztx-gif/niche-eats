/**
 * Client configuration.
 *
 * The anon key is public by design: RLS grants it read-only access to `spots`
 * and nothing else (verified — inserts return 42501). It ships in the page
 * because a static site has no build step to inject it. The service-role and
 * Google keys never appear here; they live in Edge Function secrets.
 */
export const SUPABASE_URL = 'https://ebozpvpszregjuhkucas.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVib3pwdnBzenJlZ2p1aGt1Y2FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTkyODYsImV4cCI6MjEwMDEzNTI4Nn0.ZmPnBuH7BJ7Ic1o-Qg4mKK5SE-PI3aHDigx2X0PRIAQ';
