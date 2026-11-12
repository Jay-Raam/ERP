CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'approved', 'partly_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "document_counters" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_counters_pk" PRIMARY KEY("tenant_id","kind")
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	CONSTRAINT "goods_receipt_lines_qty_positive" CHECK ("goods_receipt_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"supplier_invoice_no" text,
	"notes" text,
	"received_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "goods_receipts_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"received_quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"gst_rate" smallint NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	CONSTRAINT "purchase_order_lines_order_item_unique" UNIQUE("order_id","item_id"),
	CONSTRAINT "purchase_order_lines_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_lines_qty_positive" CHECK ("purchase_order_lines"."quantity" > 0),
	CONSTRAINT "purchase_order_lines_received_range" CHECK ("purchase_order_lines"."received_quantity" >= 0 and "purchase_order_lines"."received_quantity" <= "purchase_order_lines"."quantity"),
	CONSTRAINT "purchase_order_lines_price_positive" CHECK ("purchase_order_lines"."unit_price" > 0),
	CONSTRAINT "purchase_order_lines_gst_rate" CHECK ("purchase_order_lines"."gst_rate" in (0, 5, 12, 18, 28))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"notes" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_orders_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "purchase_orders_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_orders_approver_differs" CHECK ("purchase_orders"."approved_by" is null or "purchase_orders"."approved_by" <> "purchase_orders"."created_by")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
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
	CONSTRAINT "suppliers_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "suppliers_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."goods_receipts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_order_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "public"."purchase_order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_organisations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_receipt_idx" ON "goods_receipt_lines" USING btree ("tenant_id","receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_order_idx" ON "goods_receipts" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_list_idx" ON "purchase_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("tenant_id","supplier_id");
--> statement-breakpoint
SELECT app_enable_tenant_rls('document_counters');
--> statement-breakpoint
SELECT app_enable_tenant_rls('suppliers');
--> statement-breakpoint
SELECT app_enable_tenant_rls('purchase_orders');
--> statement-breakpoint
SELECT app_enable_tenant_rls('purchase_order_lines');
--> statement-breakpoint
SELECT app_enable_tenant_rls('goods_receipts');
--> statement-breakpoint
SELECT app_enable_tenant_rls('goods_receipt_lines');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "goods_receipts" FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "goods_receipt_lines" FROM erp_app;
