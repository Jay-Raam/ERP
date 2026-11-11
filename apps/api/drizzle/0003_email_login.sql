ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
-- Sign-in is by email alone, so the organisation is found from the email.
-- This exposes exactly one users row (the one matching app.lookup_email) to the
-- pre-login lookup, and nothing else. See findTenantByEmail() in src/db/tenant.ts.
CREATE POLICY email_lookup ON "users" FOR SELECT
  USING (email = NULLIF(current_setting('app.lookup_email', true), ''));
