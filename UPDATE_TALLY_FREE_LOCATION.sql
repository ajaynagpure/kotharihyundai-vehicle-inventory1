-- Kothari Hyundai: "Tally Done" status + Tally Done vehicles keep their location. Run ONCE in Supabase > SQL Editor. Safe to re-run.

-- 1. Old status names -> "Tally Done"
UPDATE public.vehicles SET status = 'Tally Done'
 WHERE status ILIKE '%not%deliver%' OR status ILIKE 'bill%' OR status ILIKE 'sales%';

-- 2. Gate IN: Free Stock vehicles become "In Stock" at the location.
--    Tally Done vehicles keep their status but their location is recorded (until the Delivery Entry is saved).
--    Delivered vehicles are never touched.
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
     AND (lower(coalesce(v.status, '')) NOT LIKE '%deliver%'            -- not delivered at all, or
          OR lower(coalesce(v.status, '')) LIKE '%not%deliver%');        -- "Not Delivered" (old name)
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gate_in_makes_stock ON public.gate_movements;
CREATE TRIGGER trg_gate_in_makes_stock AFTER INSERT ON public.gate_movements
  FOR EACH ROW EXECUTE FUNCTION public.gate_in_makes_stock();

-- 3. Existing Tally Done vehicles that have no location: take it from their latest gate IN entry
UPDATE public.vehicles v SET location_id = x.loc_id
  FROM (SELECT DISTINCT ON (gm.vehicle_id) gm.vehicle_id, l.id AS loc_id
          FROM public.gate_movements gm
          JOIN public.locations l ON lower(l.location_name) = lower(coalesce(gm.location_name, ''))
         WHERE upper(coalesce(gm.movement_type, '')) = 'IN' AND gm.vehicle_id IS NOT NULL
         ORDER BY gm.vehicle_id, gm.created_at DESC) x
 WHERE v.id = x.vehicle_id AND v.location_id IS NULL AND v.status ILIKE '%tally%';

NOTIFY pgrst, 'reload schema';
