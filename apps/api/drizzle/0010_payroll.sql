CREATE TYPE "public"."payroll_status" AS ENUM('draft', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "payroll_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"gross_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"deductions_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"prepared_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approve_entry_id" uuid,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"paid_on" date,
	"pay_method" text,
	"pay_reference" text,
	"pay_entry_id" uuid,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancel_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_runs_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payroll_runs_period" CHECK ("payroll_runs"."period_end" >= "payroll_runs"."period_start"),
	CONSTRAINT "payroll_runs_approver_differs" CHECK ("payroll_runs"."approved_by" is null or "payroll_runs"."approved_by" <> "payroll_runs"."prepared_by"),
	CONSTRAINT "payroll_runs_state" CHECK (case "payroll_runs"."status"
        when 'draft' then "payroll_runs"."approved_by" is null and "payroll_runs"."paid_by" is null
        when 'approved' then "payroll_runs"."approved_by" is not null and "payroll_runs"."approve_entry_id" is not null and "payroll_runs"."paid_by" is null
        when 'paid' then "payroll_runs"."approved_by" is not null and "payroll_runs"."paid_by" is not null and "payroll_runs"."pay_entry_id" is not null
        else "payroll_runs"."cancelled_at" is not null
      end),
	CONSTRAINT "payroll_runs_pay_method" CHECK ("payroll_runs"."pay_method" is null or "payroll_runs"."pay_method" in ('cash','bank','upi','cheque','card')),
	CONSTRAINT "payroll_runs_totals" CHECK ("payroll_runs"."gross_total" >= 0 and "payroll_runs"."deductions_total" >= 0 and "payroll_runs"."net_total" >= 0 and "payroll_runs"."net_total" = "payroll_runs"."gross_total" - "payroll_runs"."deductions_total")
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"employee_name" text NOT NULL,
	"designation" text,
	"basic" numeric(12, 2) NOT NULL,
	"hra" numeric(12, 2) NOT NULL,
	"allowance" numeric(12, 2) NOT NULL,
	"days_in_period" smallint NOT NULL,
	"paid_half_days" smallint NOT NULL,
	"present_days" smallint DEFAULT 0 NOT NULL,
	"half_days" smallint DEFAULT 0 NOT NULL,
	"leave_days" smallint DEFAULT 0 NOT NULL,
	"off_days" smallint DEFAULT 0 NOT NULL,
	"holiday_days" smallint DEFAULT 0 NOT NULL,
	"absent_days" smallint DEFAULT 0 NOT NULL,
	"short_days" smallint DEFAULT 0 NOT NULL,
	"incomplete_days" smallint DEFAULT 0 NOT NULL,
	"full_gross" numeric(14, 2) NOT NULL,
	"earned" numeric(14, 2) NOT NULL,
	"bonus" numeric(14, 2) DEFAULT '0' NOT NULL,
	"planned_deductions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"deductions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"other_deductions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"deductions_capped" smallint DEFAULT 0 NOT NULL,
	"adjustment_note" text,
	"net_pay" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_run_employee_unique" UNIQUE("tenant_id","run_id","employee_id"),
	CONSTRAINT "payslips_days" CHECK ("payslips"."paid_half_days" >= 0 and "payslips"."paid_half_days" <= "payslips"."days_in_period" * 2 and "payslips"."days_in_period" between 28 and 31),
	CONSTRAINT "payslips_amounts" CHECK ("payslips"."earned" >= 0 and "payslips"."bonus" >= 0 and "payslips"."deductions" >= 0 and "payslips"."other_deductions" >= 0 and "payslips"."net_pay" >= 0 and "payslips"."net_pay" = "payslips"."earned" + "payslips"."bonus" - "payslips"."deductions" - "payslips"."other_deductions")
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"basic" numeric(12, 2) NOT NULL,
	"hra" numeric(12, 2) DEFAULT '0' NOT NULL,
	"allowance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "salary_structures_employee_unique" UNIQUE("tenant_id","employee_id"),
	CONSTRAINT "salary_structures_amounts" CHECK ("salary_structures"."basic" > 0 and "salary_structures"."hra" >= 0 and "salary_structures"."allowance" >= 0 and "salary_structures"."deductions" >= 0),
	CONSTRAINT "salary_structures_limit" CHECK ("salary_structures"."basic" + "salary_structures"."hra" + "salary_structures"."allowance" <= 99999999.99)
);
--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_type";--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_prepared_by_fk" FOREIGN KEY ("tenant_id","prepared_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_paid_by_fk" FOREIGN KEY ("tenant_id","paid_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."payroll_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_period_once" ON "payroll_runs" USING btree ("tenant_id","period_start") WHERE "payroll_runs"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "payroll_runs_list_idx" ON "payroll_runs" USING btree ("tenant_id","period_start");--> statement-breakpoint
CREATE INDEX "payslips_run_idx" ON "payslips" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "payslips_employee_idx" ON "payslips" USING btree ("tenant_id","employee_id");--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_type" CHECK ("journal_entries"."source_type" in ('invoice','payment','manual','reversal','payroll'));
--> statement-breakpoint
SELECT app_enable_tenant_rls('salary_structures');
--> statement-breakpoint
SELECT app_enable_tenant_rls('payroll_runs');
--> statement-breakpoint
SELECT app_enable_tenant_rls('payslips');
--> statement-breakpoint
CREATE FUNCTION payslip_run_is_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  run_status payroll_status;
  rid uuid;
  tid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rid := OLD.run_id;
    tid := OLD.tenant_id;
  ELSE
    rid := NEW.run_id;
    tid := NEW.tenant_id;
  END IF;
  SELECT status INTO run_status FROM payroll_runs WHERE tenant_id = tid AND id = rid;
  IF run_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'payslips of a payroll run that is % cannot be changed', run_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payslips_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payslip_run_is_draft();
