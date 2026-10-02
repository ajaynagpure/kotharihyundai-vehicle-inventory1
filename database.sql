-- KOTHARI HYUNDAI VEHICLE INVENTORY - CONSOLIDATED SQL
-- Generated from project SQL files.
-- Run in Supabase SQL Editor.


-- ============================================================
-- SOURCE: GATE_LOCATION.sql
-- ============================================================
-- Gate In/Out: Location column. Safe to re-run.
ALTER TABLE public.gate_movements ADD COLUMN IF NOT EXISTS location_name text;

-- Old Bhilarwadi entries get the Bhilarwadi location.
UPDATE public.gate_movements SET location_name = 'Bhilarwadi'
WHERE location_name IS NULL AND gate_name = 'Bhilarwadi';

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: GATE_IN_DETAILS.sql
-- ============================================================
-- Bhilarwadi Vehicle IN details: 7 compressed photos and individual PDFs (private bucket) + 4 tyre serials + EV battery. Safe to re-run.
ALTER TABLE public.gate_movements
  ADD COLUMN IF NOT EXISTS photo_front text,
  ADD COLUMN IF NOT EXISTS photo_chassis_no text,
  ADD COLUMN IF NOT EXISTS photo_chassis_plate text,
  ADD COLUMN IF NOT EXISTS photo_form22 text,
  ADD COLUMN IF NOT EXISTS photo_cng_cert text,
  ADD COLUMN IF NOT EXISTS photo_cng_kit text,
  ADD COLUMN IF NOT EXISTS photo_ecu text,
  ADD COLUMN IF NOT EXISTS tyre_serial_1 text,
  ADD COLUMN IF NOT EXISTS tyre_serial_2 text,
  ADD COLUMN IF NOT EXISTS tyre_serial_3 text,
  ADD COLUMN IF NOT EXISTS tyre_serial_4 text,
  ADD COLUMN IF NOT EXISTS ev_battery_no text;

-- Private bucket, compressed photos and their PDFs, 5 MB each
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('gate-photos', 'gate-photos', false, 5242880, ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','application/pdf'];

DROP POLICY IF EXISTS gate_photos_select ON storage.objects;
CREATE POLICY gate_photos_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'gate-photos');

DROP POLICY IF EXISTS gate_photos_insert ON storage.objects;
CREATE POLICY gate_photos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'gate-photos');

-- UPDATE is needed because uploads use upsert (a retry overwrites the same file)
DROP POLICY IF EXISTS gate_photos_update ON storage.objects;
CREATE POLICY gate_photos_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'gate-photos') WITH CHECK (bucket_id = 'gate-photos');

DROP POLICY IF EXISTS gate_photos_admin_delete ON storage.objects;
CREATE POLICY gate_photos_admin_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'gate-photos' AND EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON r.id = up.role_id WHERE up.id = auth.uid() AND lower(r.name) = 'admin'));

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: GATE_BULK_EDIT_DELETE.sql
-- ============================================================
-- Gate In/Out: bulk save + edit / delete (Admin). Safe to re-run.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gate_movements TO authenticated;

DROP POLICY IF EXISTS gate_movements_admin_update ON public.gate_movements;
CREATE POLICY gate_movements_admin_update ON public.gate_movements FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON r.id = up.role_id WHERE up.id = auth.uid() AND lower(r.name) = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON r.id = up.role_id WHERE up.id = auth.uid() AND lower(r.name) = 'admin'));

DROP POLICY IF EXISTS gate_movements_admin_delete ON public.gate_movements;
CREATE POLICY gate_movements_admin_delete ON public.gate_movements FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON r.id = up.role_id WHERE up.id = auth.uid() AND lower(r.name) = 'admin'));


-- ============================================================
-- SOURCE: DELIVERY_ENTRY.sql
-- ============================================================
-- Kothari Hyundai: Delivery Entry columns. Run ONCE in Supabase > SQL Editor (after SALES_IMPORT_COLUMNS.sql). Safe to re-run.
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS delivery_no text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS delivery_location text;

ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS delivery_location text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS engine_no text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS variant text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS bill_no text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS team_leader text;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS executive text;
-- Delivery No is no longer typed in the form: make sure the old column does not block saving
DO $$ BEGIN ALTER TABLE public.deliveries ALTER COLUMN delivery_no DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: IMPORT_COLUMNS_FIX.sql
-- ============================================================
-- =====================================================================
-- KOTHARI HYUNDAI - IMPORT COLUMNS FIX  (run ONCE in Supabase > SQL Editor)
-- Safe to run again: every step is "if not exists" / only-if-needed.
-- Adds every column of SaleDealerOrderStatus.xlsx and VehicleDeliveryStatusReport.xlsx
-- to public.vehicles, removes blockers (NOT NULL / status check) so imports never fail.
-- =====================================================================
RESET ROLE;

-- 1. vehicles table (only created if it does not exist)
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now()
);

-- 2. Excel columns
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('order_date','date'),
    ('order_no','text'),
    ('pis_no','text'),
    ('model','text'),
    ('variant','text'),
    ('color','text'),
    ('order_amount','numeric(14,2)'),
    ('order_type','text'),
    ('assigned_date','date'),
    ('confirm_date','date'),
    ('vin','text'),
    ('order_status','text'),
    ('customer_id','text'),
    ('customer_name','text'),
    ('main_dealer','text'),
    ('dealer_code','text'),
    ('hmi_invoice_date','date'),
    ('hmi_invoice_no','text'),
    ('excise_invoice_no','text'),
    ('fsc','text'),
    ('variant_code','text'),
    ('engine_no','text'),
    ('finance_company','text'),
    ('departure_date','date'),
    ('lot_number','text'),
    ('transporter_name','text'),
    ('transporter_vehicle_no','text'),
    ('basic_price','numeric(14,2)'),
    ('freight_insurance','numeric(14,2)'),
    ('total_invoice_value','numeric(14,2)'),
    ('igst_pct','numeric'),
    ('igst','numeric(14,2)'),
    ('cgst_pct','numeric'),
    ('cgst','numeric(14,2)'),
    ('sgst_pct','numeric'),
    ('sgst','numeric(14,2)'),
    ('comp_cess_pct','numeric'),
    ('comp_cess','numeric(14,2)'),
    ('tcs_pct','numeric'),
    ('tcs_value','numeric(14,2)'),
    ('hmi_invoice_amount','numeric(14,2)'),
    ('hsn_code','text'),
    ('emission_type','text'),
    ('quantity','numeric'),
    ('grn_no','text'),
    ('grn_date','date'),
    ('sale_tax','numeric(14,2)'),
    ('fob_key','text'),
    ('chassis_no','text'),
    ('stock_value','numeric(14,2)'),
    ('purchase_date','date'),
    ('status','text'),
    ('chassis_no','text'),
    ('stock_value','numeric(14,2)'),
    ('purchase_date','date'),
    ('status','text'),
    ('remarks','text'),
    ('vehicle_no','text'),
    ('delivery_date','date')
  ) AS t(name, typ) LOOP
    EXECUTE format('ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS %I %s', c.name, c.typ);
  END LOOP;
END $$;

-- 3. Pending orders have no VIN yet, so no column may be NOT NULL (except id / defaults)
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicles' AND is_nullable='NO'
      AND column_default IS NULL AND is_identity='NO' AND is_generated='NEVER' AND column_name <> 'id'
  LOOP
    EXECUTE format('ALTER TABLE public.vehicles ALTER COLUMN %I DROP NOT NULL', c.column_name);
  END LOOP;
END $$;

-- 4. Status: allow 'Pending Order', 'In Transit', 'In Stock', 'Delivered'
DO $$
DECLARE t text; v text; r record;
BEGIN
  SELECT udt_name INTO t FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicles' AND column_name='status' AND data_type='USER-DEFINED';
  IF t IS NOT NULL THEN
    FOREACH v IN ARRAY ARRAY['Pending Order','In Transit','In Stock','Delivered'] LOOP
      BEGIN EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS %L', t, v);
      EXCEPTION WHEN others THEN NULL; END;
    END LOOP;
  END IF;
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid='public.vehicles'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.vehicles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 5. Import history table
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS import_type text;
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS total_rows integer;
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS successful_rows integer;
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS failed_rows integer;
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS status text;

-- 6. Permissions (Admin + Accounts may import; everyone signed-in may read)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles, public.import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles, public.import_batches TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
             AND c.relname IN ('vehicles','import_batches')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'import_read_'||r.relname, r.relname);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', 'import_read_'||r.relname, r.relname);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'import_write_'||r.relname, r.relname);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles ro ON ro.id=up.role_id
                     WHERE up.id=auth.uid() AND up.active IS NOT FALSE AND lower(trim(ro.name)) IN ('admin','accounts')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles ro ON ro.id=up.role_id
                     WHERE up.id=auth.uid() AND up.active IS NOT FALSE AND lower(trim(ro.name)) IN ('admin','accounts')))$p$,
      'import_write_'||r.relname, r.relname);
  END LOOP;
END $$;

-- 7. Helpful lookup indexes (not unique, so they can never fail on old data)
CREATE INDEX IF NOT EXISTS vehicles_vin_idx ON public.vehicles (vin);
CREATE INDEX IF NOT EXISTS vehicles_order_no_idx ON public.vehicles (order_no);

-- 8. Refresh the API schema cache so new columns work immediately
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: SALES_IMPORT_COLUMNS.sql
-- ============================================================
-- Kothari Hyundai: Sales report import columns. Run ONCE in Supabase > SQL Editor. Safe to re-run.
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS bill_date date;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS bill_no text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS team_leader text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS executive text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS sales_location text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS bill_amount numeric(14,2);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS sales_imported_at timestamptz;
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: RENAME_SALES_STATUS.sql
-- ============================================================
-- Kothari Hyundai: status "Bill / Not Delivered" renamed to "Sales / Not Delivered".
-- Run ONCE in Supabase > SQL Editor (updates vehicles already imported). Safe to re-run.
UPDATE public.vehicles SET status = 'Sales / Not Delivered'
 WHERE status ILIKE 'bill%not%deliver%';
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: BHILARWADI_GATE_PURCHASE_AUTOFILL.sql
-- ============================================================
-- Bhilarwadi In / Out - Purchase Report auto-fill support
RESET ROLE;

-- Vehicle number is optional in old databases; add it for Purchase Report data.
ALTER TABLE IF EXISTS public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_no text;

ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS receipt_dt date;

ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS remarks text;

GRANT SELECT ON public.vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.gate_movements TO authenticated;

-- Branch/Bhilarwadi gate: manual vehicle details + Purchase Report VIN suggestions
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS vehicle_no text;
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS vin text;
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS engine_no text;
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS variant text;
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS finance_bank text;
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS gate_name text;
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS driver_name text;
ALTER TABLE IF EXISTS public.gate_movements
  ADD COLUMN IF NOT EXISTS driver_mobile text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gate_movements TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gate_movements' AND column_name='vehicle_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.gate_movements ALTER COLUMN vehicle_id DROP NOT NULL';
  END IF;
END $$;

-- ============================================================
-- SOURCE: NEW_FEATURES.sql + UPDATE_TALLY_FREE_LOCATION.sql
-- ============================================================
-- Kothari Hyundai v3: run ONCE in Supabase > SQL Editor. Safe to re-run.

-- 1. Gate pass photo saved with each Bhilarwadi / Branch In-Out entry
ALTER TABLE public.gate_movements ADD COLUMN IF NOT EXISTS gate_pass_file text;

-- 2. Marks vehicles that came from the Sales report import (Imported Data window)
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS sales_imported_at timestamptz;

-- 3. Make sure the Bhilarwadi location exists (so vehicles received there show in Location wise stock)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE lower(location_name) = 'bhilarwadi') THEN
    INSERT INTO public.locations (location_name, active) VALUES ('Bhilarwadi', true);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Bhilarwadi location not created automatically (%). Add it in Settings > Locations.', SQLERRM;
END $$;

-- 4. Normalize earlier Tally Done statuses.
UPDATE public.vehicles SET status = 'Tally Done'
 WHERE status ILIKE '%not%deliver%' OR status ILIKE 'bill%' OR status ILIKE 'sales%';

-- 5. Vehicle IN records the location; Tally Done keeps its status until Delivery Entry is saved.
--    Delivered vehicles are never moved back.
CREATE OR REPLACE FUNCTION public.gate_in_makes_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE loc uuid;
BEGIN
  IF NEW.vehicle_id IS NULL OR upper(coalesce(NEW.movement_type, '')) <> 'IN' THEN RETURN NEW; END IF;
  SELECT id INTO loc FROM public.locations WHERE lower(location_name) = lower(coalesce(NEW.location_name, '')) LIMIT 1;
  UPDATE public.vehicles v
     SET status = CASE WHEN lower(coalesce(v.status, '')) LIKE '%tally%'
                         OR lower(coalesce(v.status, '')) LIKE '%not%deliver%'
                         OR lower(coalesce(v.status, '')) LIKE '%bill%'
                       THEN v.status ELSE 'In Stock' END,
         location_id = COALESCE(loc, v.location_id)
   WHERE v.id = NEW.vehicle_id
     AND (lower(coalesce(v.status, '')) NOT LIKE '%deliver%'
          OR lower(coalesce(v.status, '')) LIKE '%not%deliver%');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gate_in_makes_stock ON public.gate_movements;
CREATE TRIGGER trg_gate_in_makes_stock AFTER INSERT ON public.gate_movements
  FOR EACH ROW EXECUTE FUNCTION public.gate_in_makes_stock();

-- 6. Existing Tally Done vehicles without a location use their latest gate IN location.
UPDATE public.vehicles v SET location_id = x.loc_id
  FROM (SELECT DISTINCT ON (gm.vehicle_id) gm.vehicle_id, l.id AS loc_id
          FROM public.gate_movements gm
          JOIN public.locations l ON lower(l.location_name) = lower(coalesce(gm.location_name, ''))
         WHERE upper(coalesce(gm.movement_type, '')) = 'IN' AND gm.vehicle_id IS NOT NULL
         ORDER BY gm.vehicle_id, gm.created_at DESC) x
 WHERE v.id = x.vehicle_id AND v.location_id IS NULL AND v.status ILIKE '%tally%';

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: ADMIN_DATA_TOOLS.sql
-- ============================================================
-- Kothari Hyundai: Settings that save, Data Management (delete / reset) and Admin edit rights. Safe to re-run.

-- 1. Extra company fields used by the Company settings page and the Gate Pass header
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS gate_pass_note text;
INSERT INTO public.company_settings (id, company_name) VALUES (1, 'Kothari Hyundai') ON CONFLICT (id) DO NOTHING;

-- 2. Default system settings (ageing buckets, page size, dashboard rows, import rules)
INSERT INTO public.system_settings (setting_key, setting_value, description) VALUES
 ('age_limit_1','30','Ageing bucket 1 up to (days)'),
 ('age_limit_2','60','Ageing bucket 2 up to (days)'),
 ('age_limit_3','90','Ageing bucket 3 up to (days)'),
 ('vehicle_page_size','50','Vehicle Stock rows per page'),
 ('dashboard_recent_rows','8','Dashboard recent movements shown'),
 ('imp_order_invoiced_to_transit','true','Order import: Invoiced rows go to In Transit'),
 ('imp_purchase_moves_pending','true','Purchase import: Pending Order moves to In Transit')
ON CONFLICT (setting_key) DO NOTHING;

-- 3. Everybody signed in can READ settings (needed for company name, ageing, page size); only Admin can change them
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_settings','system_settings','import_configuration'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_read_' || t, t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', 'authenticated_read_' || t, t);
    END IF;
  END LOOP;
END $$;

-- 4. Admin can add / edit / delete on every business table (edit vehicles, locations, roles, deliveries, gate, imports, reset)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles','locations','gate_movements','deliveries','import_batches','vehicle_timeline','audit_logs',
                           'company_settings','system_settings','import_configuration','roles','user_profiles'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admin_full_access_' || t, t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', 'admin_full_access_' || t, t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: ADMIN_FEATURES.sql
-- ============================================================
RESET ROLE;

-- Admin/Settings support tables
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(role_id, permission_id)
);

INSERT INTO public.permissions(code,name,description) VALUES
('dashboard.view','Dashboard','View dashboard'),
('vehicle.view','Vehicle Stock','View vehicle stock'),
('vehicle.update','Vehicle Update','Update vehicle records'),
('import.order','Order Import','Import order reports'),
('import.purchase','Purchase Import','Import purchase reports'),
('import.sales','Sales Import','Import sales reports'),
('gate.inout','Vehicle In/Out','Manage gate movements'),
('gate.pass','Gate Pass','Manage gate passes'),
('delivery.manage','Delivery','Manage deliveries'),
('reports.view','Reports','View all reports'),
('value.view','Stock Value','View monetary values across the app'),
('users.manage','Users','Create and manage users'),
('permissions.manage','Permissions','Manage permissions'),
('settings.manage','Settings','Manage system settings')
ON CONFLICT(code) DO UPDATE SET name=excluded.name, description=excluded.description;

CREATE TABLE IF NOT EXISTS public.company_settings (
  id integer PRIMARY KEY DEFAULT 1,
  company_name text,
  brand text,
  gstin text,
  address text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_configuration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type text UNIQUE NOT NULL,
  target_table text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.import_configuration(import_type,target_table) VALUES
('ORDER','orders'),('PURCHASE','vehicles'),('SALES','sales')
ON CONFLICT(import_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value text,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.system_settings(setting_key,setting_value,description) VALUES
('system_name','Kothari Hyundai Vehicle Inventory','Application name'),
('currency','INR','Display currency'),
('date_format','DD-MM-YYYY','Display date format')
ON CONFLICT(setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_username text,
  action text NOT NULL,
  module text,
  entity_type text,
  entity_id text,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permissions_admin_all ON public.permissions;
CREATE POLICY permissions_admin_all ON public.permissions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS role_permissions_admin_all ON public.role_permissions;
CREATE POLICY role_permissions_admin_all ON public.role_permissions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS company_settings_admin_all ON public.company_settings;
CREATE POLICY company_settings_admin_all ON public.company_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS import_configuration_admin_all ON public.import_configuration;
CREATE POLICY import_configuration_admin_all ON public.import_configuration FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS system_settings_admin_all ON public.system_settings;
CREATE POLICY system_settings_admin_all ON public.system_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_read ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT ON public.permissions, public.role_permissions, public.company_settings, public.import_configuration, public.system_settings, public.audit_logs TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.role_permissions, public.company_settings, public.import_configuration, public.system_settings TO authenticated;


-- ============================================================
-- SOURCE: KOTHARI_DASHBOARD_PERMISSIONS.sql
-- ============================================================
RESET ROLE;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE public.vehicles TO authenticated;
GRANT SELECT ON TABLE public.locations TO authenticated;
GRANT SELECT ON TABLE public.dashboard_stock_summary TO authenticated;
GRANT SELECT ON TABLE public.location_stock_report TO authenticated;
GRANT SELECT ON TABLE public.model_stock_report TO authenticated;
GRANT SELECT ON TABLE public.finance_stock_report TO authenticated;
GRANT SELECT ON TABLE public.dealer_code_stock_report TO authenticated;
GRANT SELECT ON TABLE public.gate_movement_report TO authenticated;


-- ============================================================
-- SOURCE: KOTHARI_PERMISSION_FIX.sql
-- ============================================================
-- KOTHARI HYUNDAI - FINAL DATABASE PERMISSION FIX
-- Run this whole script in Supabase SQL Editor.
-- Safe for missing report/view objects: it only grants on objects that exist.

RESET ROLE;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- ---------------------------------------------------------
-- 1. Read access to existing public tables/views
-- ---------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relkind IN ('r','p','v','m')
      AND c.relname NOT LIKE 'pg_%'
  LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', r.relname);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', r.relname);
  END LOOP;
END $$;

-- ---------------------------------------------------------
-- 2. Required write access for the application
-- RLS policies below still control protected tables.
-- ---------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relkind IN ('r','p')
      AND c.relname IN (
        'vehicles',
        'gate_movements',
        'deliveries',
        'import_batches',
        'user_profiles',
        'roles',
        'permissions',
        'role_permissions',
        'app_permissions',
        'user_permissions',
        'audit_logs',
        'admin_audit_logs',
        'company_settings',
        'import_configuration',
        'system_settings'
      )
  LOOP
    EXECUTE format(
      'GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      r.relname
    );
    EXECUTE format(
      'GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      r.relname
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------
-- 3. Sequence permissions for inserts
-- ---------------------------------------------------------
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ---------------------------------------------------------
-- 4. Admin = full access on existing tables that use RLS
-- This fixes "permission denied" for the Admin account while
-- leaving non-admin access controlled by their existing policies.
-- ---------------------------------------------------------
DO $$
DECLARE
  r record;
  policy_name text;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relkind IN ('r','p')
      AND c.relrowsecurity = true
      AND c.relname IN (
        'vehicles',
        'locations',
        'gate_movements',
        'deliveries',
        'import_batches',
        'user_profiles',
        'roles',
        'permissions',
        'role_permissions',
        'app_permissions',
        'user_permissions',
        'audit_logs',
        'admin_audit_logs',
        'company_settings',
        'import_configuration',
        'system_settings',
        'vehicle_timeline'
      )
  LOOP
    policy_name := 'admin_full_access_' || r.relname;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_name, r.relname
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I
       FOR ALL TO authenticated
       USING (public.is_admin())
       WITH CHECK (public.is_admin())',
      policy_name, r.relname
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------
-- 5. Authenticated read access for inventory/report data
-- Needed by Dashboard, Viewer and Accounts screens when RLS
-- is enabled on these operational tables.
-- ---------------------------------------------------------
DO $$
DECLARE
  r record;
  policy_name text;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relkind IN ('r','p')
      AND c.relrowsecurity = true
      AND c.relname IN (
        'vehicles',
        'locations',
        'gate_movements',
        'deliveries',
        'vehicle_timeline',
        'import_batches'
      )
  LOOP
    policy_name := 'authenticated_read_' || r.relname;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_name, r.relname
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I
       FOR SELECT TO authenticated
       USING (true)',
      policy_name, r.relname
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------
-- 6. Admin verification RPC
-- Used by create-user Edge Function.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path=public
SET row_security=off
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id=up.role_id
    WHERE up.id=p_user_id
      AND up.active=true
      AND lower(trim(r.name))='admin'
  );
$$;

ALTER FUNCTION public.verify_admin_user(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_admin_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_user(uuid) TO service_role;

-- ---------------------------------------------------------
-- 7. Show current Admin profile for verification
-- ---------------------------------------------------------
SELECT
  up.id,
  up.username,
  up.full_name,
  r.name AS role,
  up.location_id,
  up.active
FROM public.user_profiles up
LEFT JOIN public.roles r ON r.id=up.role_id
WHERE lower(up.username)='admin';


-- ============================================================
-- SOURCE: kothari_hyundai_clean_rbac.sql
-- ============================================================
-- KOTHARI HYUNDAI - CLEAN USER/RBAC SETUP
-- Username + Password only.
-- No phone number, no OTP, no password-reset email.
-- Run after your existing vehicle inventory tables are present.

create extension if not exists pgcrypto;

-- Roles
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

insert into public.roles(name, description) values
('Admin', 'Full System, Users, Roles, Permissions, Settings'),
('Accounts', 'Vehicle Stock, Purchase Import, Order Import, Finance Reports, Inventory, Gate, Delivery, All Reports'),
('Gate Operator', 'Vehicle In/Out, Gate Pass, In-Out Register'),
('Viewer', 'Dashboard and Reports only')
on conflict (name) do update
set description = excluded.description;

-- User profile: only fields actually needed by the website
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  full_name text,
  role_id uuid references public.roles(id),
  location_id uuid references public.locations(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists username text;

alter table public.user_profiles
  add column if not exists full_name text;

alter table public.user_profiles
  add column if not exists role_id uuid references public.roles(id);

alter table public.user_profiles
  add column if not exists location_id uuid references public.locations(id);

alter table public.user_profiles
  add column if not exists active boolean default true;

alter table public.user_profiles
  add column if not exists created_at timestamptz default now();

alter table public.user_profiles
  add column if not exists updated_at timestamptz default now();

-- Remove old phone field/index from the previous OTP design
drop index if exists public.user_profiles_phone_uidx;
alter table public.user_profiles drop column if exists phone;

create unique index if not exists user_profiles_username_uidx
on public.user_profiles(lower(username));

-- Admin helper
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.user_profiles up
    join public.roles r on r.id = up.role_id
    where up.id = auth.uid()
      and up.active = true
      and lower(r.name) = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Login/profile helpers: username can be changed without changing the internal Supabase Auth email.
-- The login email is synthetic (username@login.kotharihyundai.local) and is never shown in the UI.
create or replace function public.get_login_email(p_username text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select au.email
  from auth.users au
  join public.user_profiles up on up.id = au.id
  where lower(up.username) = lower(trim(p_username))
    and up.active = true
  limit 1;
$$;

revoke all on function public.get_login_email(text) from public;
grant execute on function public.get_login_email(text) to anon, authenticated;

create or replace function public.update_my_profile(p_username text, p_full_name text)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := lower(regexp_replace(trim(coalesce(p_username,'')), '\s+', '', 'g'));
  v_name text := trim(coalesce(p_full_name,''));
  v_row public.user_profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if v_username = '' then
    raise exception 'Username is required';
  end if;
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  if length(v_username) < 3 then
    raise exception 'Username must be at least 3 characters';
  end if;
  if exists (select 1 from public.user_profiles where lower(username)=v_username and id <> auth.uid()) then
    raise exception 'Username already exists';
  end if;

  update public.user_profiles
     set username=v_username, full_name=v_name, updated_at=now()
   where id=auth.uid()
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Profile not found';
  end if;
  return v_row;
end;
$$;

revoke all on function public.update_my_profile(text,text) from public;
grant execute on function public.update_my_profile(text,text) to authenticated;

-- RLS
alter table public.user_profiles enable row level security;
alter table public.roles enable row level security;

drop policy if exists "user_profiles_read_own" on public.user_profiles;
create policy "user_profiles_read_own"
on public.user_profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "user_profiles_admin_all" on public.user_profiles;
create policy "user_profiles_admin_all"
on public.user_profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "roles_read_authenticated" on public.roles;
create policy "roles_read_authenticated"
on public.roles
for select
to authenticated
using (true);

drop policy if exists "roles_admin_write" on public.roles;
create policy "roles_admin_write"
on public.roles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Updated timestamp
create or replace function public.set_user_profiles_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_updated_at
on public.user_profiles;

create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_user_profiles_updated_at();

-- NOTE:
-- The first Admin must be bootstrapped once by creating a Supabase Auth user
-- and inserting its matching user_profiles row with the Admin role.
-- After that, Admin can create all other users from the website.



-- CONSOLIDATED ADMIN LOGIN SETUP
-- IMPORTANT: database.sql NEVER sets or resets the Admin Auth password.
-- Manage the Admin password only from Profile -> Change Password.

-- Keep only the Admin username for the website login.
update public.user_profiles up
set username = 'admin',
    full_name = coalesce(nullif(full_name,''), 'Admin'),
    active = true,
    updated_at = now()
where up.id = (
  select id from auth.users
  where lower(email) = lower('shubhamdamajighar6987@gmail.com')
  limit 1
);

-- If a separate admin2 profile exists, disable it rather than deleting data.
update public.user_profiles
set active = false, updated_at = now()
where lower(username) = 'admin2';

-- Verify the Admin profile.
select up.id, up.username, up.full_name, up.active, r.name as role
from public.user_profiles up
left join public.roles r on r.id = up.role_id
where lower(up.username) in ('admin','admin2');


-- ============================================================
-- USER PASSWORD DISPLAY (ADMIN USER LIST)
-- ============================================================
-- NOTE: Supabase Auth never exposes the real password. This column stores the
-- password entered when an Admin creates a user so Admin can reveal it with
-- the eye button in the Users screen. Use only if this operational requirement
-- is intentional; plaintext password storage is less secure than standard Auth.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS password_display text;

NOTIFY pgrst, 'reload schema';

-- Admin can save/display the password entered while creating a user.
DROP POLICY IF EXISTS user_profiles_admin_update ON public.user_profiles;
CREATE POLICY user_profiles_admin_update ON public.user_profiles
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.user_profiles me
  JOIN public.roles rr ON rr.id = me.role_id
  WHERE me.id = auth.uid() AND lower(rr.name) = 'admin'
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.user_profiles me
  JOIN public.roles rr ON rr.id = me.role_id
  WHERE me.id = auth.uid() AND lower(rr.name) = 'admin'
));

-- Disable the old admin2 profile if it exists.
UPDATE public.user_profiles SET active = false WHERE lower(username) = 'admin2';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ADMIN USER DELETE FIX
-- ============================================================
-- Deletes the real Supabase Auth account, not only public.user_profiles.
-- Because public.user_profiles.id references auth.users(id) with ON DELETE CASCADE,
-- deleting auth.users also removes the matching profile.
CREATE OR REPLACE FUNCTION public.delete_user_account(target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  is_admin boolean;
  deleted_id uuid;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete yourself';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id = up.role_id
    WHERE up.id = auth.uid()
      AND up.active = true
      AND lower(r.name) = 'admin'
  ) INTO is_admin;

  IF NOT is_admin THEN
    RAISE EXCEPTION 'Only Admin can delete users';
  END IF;

  DELETE FROM auth.users
  WHERE id = target_user_id
  RETURNING id INTO deleted_id;

  RETURN deleted_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- SOURCE: LOCATION_ACCESS_SECURITY.sql
-- ============================================================
-- Assigned-location users see only their location; only Admin retains all-location access.
CREATE OR REPLACE FUNCTION public.current_user_location_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT location_id FROM public.user_profiles
   WHERE id = auth.uid() AND active IS NOT FALSE LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_user_location_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_location_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.gate_destination_locations()
RETURNS TABLE(location_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.location_name
  FROM public.locations l
  WHERE l.active IS DISTINCT FROM FALSE
    AND l.id <> public.current_user_location_id()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.active IS NOT FALSE
        AND up.location_id IS NOT NULL
    )
  ORDER BY l.location_name;
$$;
REVOKE ALL ON FUNCTION public.gate_destination_locations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gate_destination_locations() TO authenticated;

CREATE OR REPLACE FUNCTION public.location_row_allowed(p_location_id uuid, p_location_name text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_location_id uuid;
  v_location_name text;
  v_active boolean;
BEGIN
  SELECT location_id, active INTO v_location_id, v_active
    FROM public.user_profiles WHERE id = auth.uid();
  IF NOT FOUND OR v_active IS FALSE THEN RETURN false; END IF;
  IF public.is_admin() THEN RETURN true; END IF;
  IF v_location_id IS NULL THEN RETURN false; END IF;
  IF p_location_id = v_location_id THEN RETURN true; END IF;
  IF p_location_id IS NOT NULL OR p_location_name IS NULL THEN RETURN false; END IF;
  SELECT location_name INTO v_location_name FROM public.locations WHERE id = v_location_id;
  RETURN lower(trim(coalesce(p_location_name, ''))) = lower(trim(coalesce(v_location_name, '')));
END;
$$;
REVOKE ALL ON FUNCTION public.location_row_allowed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.location_row_allowed(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_gate_photo(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vin text;
BEGIN
  v_vin := CASE WHEN split_part(coalesce(p_name, ''), '/', 1) = 'gatepass'
    THEN split_part(p_name, '/', 2) ELSE split_part(coalesce(p_name, ''), '/', 1) END;
  IF v_vin = '' THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.vehicles v WHERE upper(coalesce(v.vin, '')) = upper(v_vin)
      AND (public.location_row_allowed(v.location_id, v.delivery_location)
        OR public.location_row_allowed(v.location_id, v.sales_location))
  ) OR EXISTS (
    SELECT 1 FROM public.gate_movements gm WHERE upper(coalesce(gm.vin, '')) = upper(v_vin)
      AND (public.location_row_allowed(NULL, gm.location_name)
        OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = gm.vehicle_id
          AND (public.location_row_allowed(v.location_id, v.delivery_location)
            OR public.location_row_allowed(v.location_id, v.sales_location))))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.can_access_gate_photo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_gate_photo(text) TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles','locations','gate_movements','deliveries','vehicle_timeline','import_batches'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_read_' || t, t);
    END IF;
  END LOOP;
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS import_read_vehicles ON public.vehicles';
    EXECUTE 'DROP POLICY IF EXISTS import_write_vehicles ON public.vehicles';
  END IF;
  IF to_regclass('public.import_batches') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS import_read_import_batches ON public.import_batches';
    EXECUTE 'DROP POLICY IF EXISTS import_write_import_batches ON public.import_batches';
  END IF;
END $$;

DROP POLICY IF EXISTS locations_location_scope ON public.locations;
CREATE POLICY locations_location_scope ON public.locations FOR SELECT TO authenticated
USING (public.location_row_allowed(id, location_name));

DROP POLICY IF EXISTS vehicles_location_scope ON public.vehicles;
CREATE POLICY vehicles_location_scope ON public.vehicles FOR SELECT TO authenticated
USING (public.location_row_allowed(location_id, delivery_location)
    OR public.location_row_allowed(location_id, sales_location));

-- Accounts may import and update only vehicles in their assigned location.
DROP POLICY IF EXISTS import_write_vehicles ON public.vehicles;
CREATE POLICY import_write_vehicles ON public.vehicles FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON r.id=up.role_id
    WHERE up.id=auth.uid() AND up.active IS NOT FALSE AND lower(trim(r.name)) IN ('admin','accounts'))
  AND (public.location_row_allowed(location_id, delivery_location)
    OR public.location_row_allowed(location_id, sales_location))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON r.id=up.role_id
    WHERE up.id=auth.uid() AND up.active IS NOT FALSE AND lower(trim(r.name)) IN ('admin','accounts'))
  AND (public.location_row_allowed(location_id, delivery_location)
    OR public.location_row_allowed(location_id, sales_location))
);

DROP POLICY IF EXISTS gate_movements_location_scope ON public.gate_movements;
CREATE POLICY gate_movements_location_scope ON public.gate_movements FOR SELECT TO authenticated
USING (public.location_row_allowed(NULL, location_name)
  OR EXISTS (
    SELECT 1 FROM public.vehicles v WHERE v.id=gate_movements.vehicle_id
      AND (public.location_row_allowed(v.location_id, v.delivery_location)
        OR public.location_row_allowed(v.location_id, v.sales_location))
  ));

DROP POLICY IF EXISTS gate_movements_location_insert ON public.gate_movements;
-- Assigned users may select an OUT destination, but only for a vehicle in their assigned location.
CREATE POLICY gate_movements_location_insert ON public.gate_movements FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.active IS NOT FALSE)
  AND (
    (public.location_row_allowed(NULL, location_name)
      AND (vehicle_id IS NULL OR EXISTS (
        SELECT 1 FROM public.vehicles v WHERE v.id = gate_movements.vehicle_id
          AND (public.location_row_allowed(v.location_id, v.delivery_location)
            OR public.location_row_allowed(v.location_id, v.sales_location))
      )))
    OR (NOT public.is_admin()
      AND upper(trim(coalesce(movement_type, ''))) = 'OUT'
      AND vehicle_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = gate_movements.vehicle_id
        AND (public.location_row_allowed(v.location_id, v.delivery_location)
          OR public.location_row_allowed(v.location_id, v.sales_location)))
      AND EXISTS (SELECT 1 FROM public.locations l
        WHERE l.active IS DISTINCT FROM FALSE
          AND lower(trim(l.location_name)) = lower(trim(coalesce(gate_movements.location_name, '')))
          AND l.id <> public.current_user_location_id()))
  )
);

DO $$
BEGIN
  IF to_regclass('public.deliveries') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS deliveries_location_scope ON public.deliveries';
    EXECUTE $p$CREATE POLICY deliveries_location_scope ON public.deliveries FOR SELECT TO authenticated
      USING (public.location_row_allowed(NULL, delivery_location)
        OR (delivery_location IS NULL AND EXISTS (
          SELECT 1 FROM public.vehicles v WHERE v.id=deliveries.vehicle_id
            AND (public.location_row_allowed(v.location_id, v.delivery_location)
              OR public.location_row_allowed(v.location_id, v.sales_location))
        )))$p$;
  END IF;
  IF to_regclass('public.vehicle_timeline') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS vehicle_timeline_location_scope ON public.vehicle_timeline';
    EXECUTE $p$CREATE POLICY vehicle_timeline_location_scope ON public.vehicle_timeline FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=vehicle_timeline.vehicle_id
        AND (public.location_row_allowed(v.location_id, v.delivery_location)
          OR public.location_row_allowed(v.location_id, v.sales_location))))$p$;
  END IF;
  IF to_regclass('public.import_batches') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS import_batches_location_scope ON public.import_batches';
    EXECUTE $p$CREATE POLICY import_batches_location_scope ON public.import_batches FOR SELECT TO authenticated
      USING (public.location_row_allowed(NULL, NULL))$p$;
    EXECUTE 'DROP POLICY IF EXISTS import_write_import_batches ON public.import_batches';
    EXECUTE $p$CREATE POLICY import_write_import_batches ON public.import_batches FOR INSERT TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON r.id=up.role_id
        WHERE up.id=auth.uid() AND up.active IS NOT FALSE AND lower(trim(r.name)) IN ('admin','accounts')))$p$;
  END IF;
END $$;

DROP POLICY IF EXISTS gate_photos_select ON storage.objects;
CREATE POLICY gate_photos_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='gate-photos' AND public.can_access_gate_photo(name));

DROP POLICY IF EXISTS gate_photos_update ON storage.objects;
CREATE POLICY gate_photos_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='gate-photos' AND public.can_access_gate_photo(name))
WITH CHECK (bucket_id='gate-photos' AND public.can_access_gate_photo(name));

DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['gate_movement_report','location_stock_report','model_stock_report',
    'finance_stock_report','dealer_code_stock_report','aging_report','in_transit_report',
    'pending_order_report','delivery_report','dashboard_stock_summary'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v AND c.relkind='v') THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
