CREATE TYPE "public"."sales_order_status" AS ENUM('draft', 'confirmed', 'partly_delivered', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('sales', 'purchase');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'posted', 'cancelled');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"gstin" text,
	"address" text,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "customers_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "customers_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"reference" text,
	"notes" text,
	"delivered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "deliveries_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "delivery_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	CONSTRAINT "delivery_lines_qty_positive" CHECK ("delivery_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"delivered_quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"gst_rate" smallint NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	CONSTRAINT "sales_order_lines_order_item_unique" UNIQUE("order_id","item_id"),
	CONSTRAINT "sales_order_lines_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_order_lines_qty_positive" CHECK ("sales_order_lines"."quantity" > 0),
	CONSTRAINT "sales_order_lines_delivered_range" CHECK ("sales_order_lines"."delivered_quantity" >= 0 and "sales_order_lines"."delivered_quantity" <= "sales_order_lines"."quantity"),
	CONSTRAINT "sales_order_lines_price_positive" CHECK ("sales_order_lines"."unit_price" > 0),
	CONSTRAINT "sales_order_lines_gst_rate" CHECK ("sales_order_lines"."gst_rate" in (0, 5, 12, 18, 28))
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" "sales_order_status" DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"notes" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sales_orders_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "sales_orders_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_orders_confirmer_differs" CHECK ("sales_orders"."confirmed_by" is null or "sales_orders"."confirmed_by" <> "sales_orders"."created_by")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "accounts_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "accounts_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"gst_rate" smallint NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	CONSTRAINT "invoice_lines_qty_positive" CHECK ("invoice_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"delivery_id" uuid,
	"receipt_id" uuid,
	"reference" text,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"notes" text,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_total" numeric(18, 2) NOT NULL,
	"grand_total" numeric(18, 2) NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_entry_id" uuid,
	"created_by" uuid NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoices_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "invoices_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_party_matches_kind" CHECK (("invoices"."kind" = 'sales' and "invoices"."customer_id" is not null and "invoices"."supplier_id" is null and "invoices"."delivery_id" is not null and "invoices"."receipt_id" is null)
        or ("invoices"."kind" = 'purchase' and "invoices"."supplier_id" is not null and "invoices"."customer_id" is null and "invoices"."receipt_id" is not null and "invoices"."delivery_id" is null)),
	CONSTRAINT "invoices_paid_range" CHECK ("invoices"."paid_amount" >= 0 and "invoices"."paid_amount" <= "invoices"."grand_total"),
	CONSTRAINT "invoices_total_positive" CHECK ("invoices"."grand_total" > 0),
	CONSTRAINT "invoices_due_after_date" CHECK ("invoices"."due_date" >= "invoices"."invoice_date")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"branch_id" uuid,
	"reversal_of" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "journal_entries_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "journal_entries_source_type" CHECK ("journal_entries"."source_type" in ('invoice','payment','manual','reversal'))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "journal_lines_one_side" CHECK (("journal_lines"."debit" > 0 and "journal_lines"."credit" = 0) or ("journal_lines"."credit" > 0 and "journal_lines"."debit" = 0))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" text NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text,
	"journal_entry_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "payments_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "payments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_method" CHECK ("payments"."method" in ('cash','bank','upi','cheque','card')),
	CONSTRAINT "payments_void_complete" CHECK (("payments"."voided_at" is null and "payments"."voided_by" is null and "payments"."void_reason" is null)
        or ("payments"."voided_at" is not null and "payments"."voided_by" is not null and "payments"."void_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."sales_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivered_by_fk" FOREIGN KEY ("tenant_id","delivered_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_fk" FOREIGN KEY ("tenant_id","delivery_id") REFERENCES "public"."deliveries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_order_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "public"."sales_order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."sales_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_supplier_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_confirmed_by_fk" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_delivery_fk" FOREIGN KEY ("tenant_id","delivery_id") REFERENCES "public"."deliveries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."goods_receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journal_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_posted_by_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_fk" FOREIGN KEY ("tenant_id","reversal_of") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_fk" FOREIGN KEY ("tenant_id","voided_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_order_idx" ON "deliveries" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_lines_delivery_idx" ON "delivery_lines" USING btree ("tenant_id","delivery_id");--> statement-breakpoint
CREATE INDEX "sales_orders_list_idx" ON "sales_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_orders_customer_idx" ON "sales_orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_delivery_once" ON "invoices" USING btree ("tenant_id","delivery_id") WHERE "invoices"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_receipt_once" ON "invoices" USING btree ("tenant_id","receipt_id") WHERE "invoices"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "invoices_list_idx" ON "invoices" USING btree ("tenant_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_reversal_once" ON "journal_entries" USING btree ("tenant_id","reversal_of");--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("tenant_id","entry_date","created_at");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("tenant_id","entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_list_idx" ON "payments" USING btree ("tenant_id","kind","created_at");
--> statement-breakpoint
SELECT app_enable_tenant_rls('customers');
--> statement-breakpoint
SELECT app_enable_tenant_rls('sales_orders');
--> statement-breakpoint
SELECT app_enable_tenant_rls('sales_order_lines');
--> statement-breakpoint
SELECT app_enable_tenant_rls('deliveries');
--> statement-breakpoint
SELECT app_enable_tenant_rls('delivery_lines');
--> statement-breakpoint
SELECT app_enable_tenant_rls('accounts');
--> statement-breakpoint
SELECT app_enable_tenant_rls('journal_entries');
--> statement-breakpoint
SELECT app_enable_tenant_rls('journal_lines');
--> statement-breakpoint
SELECT app_enable_tenant_rls('invoices');
--> statement-breakpoint
SELECT app_enable_tenant_rls('invoice_lines');
--> statement-breakpoint
SELECT app_enable_tenant_rls('payments');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "deliveries" FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "delivery_lines" FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "journal_entries" FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "journal_lines" FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "invoice_lines" FROM erp_app;
--> statement-breakpoint
CREATE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d numeric;
  c numeric;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO d, c
    FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'journal entry % is not balanced (debit %, credit %)', NEW.entry_id, d, c
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
