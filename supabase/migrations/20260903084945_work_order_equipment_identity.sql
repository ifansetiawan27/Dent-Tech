-- Technician-confirmed equipment identity snapshot for each service work order.
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS serviced_equipment_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS serviced_equipment_type_model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS serviced_equipment_serial_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS equipment_identity_confirmed_at text,
  ADD COLUMN IF NOT EXISTS equipment_identity_confirmed_by text REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS equipment_identity_version integer NOT NULL DEFAULT 0;

-- Seed existing work orders from request/master data without claiming technician confirmation.
UPDATE work_orders wo
SET serviced_equipment_name = COALESCE(NULLIF(e.name, ''), NULLIF(t.equipment_brand, ''), NULLIF(t.equipment_type, ''), ''),
    serviced_equipment_type_model = COALESCE(NULLIF(e.model, ''), NULLIF(CONCAT_WS(' — ', NULLIF(t.equipment_type, ''), NULLIF(t.equipment_brand, '')), ''), NULLIF(e.category, ''), ''),
    serviced_equipment_serial_number = COALESCE(NULLIF(e.serial_number, ''), '')
FROM tickets t
LEFT JOIN equipment e ON e.id = t.equipment_id
WHERE t.id = wo.ticket_id
  AND wo.equipment_identity_version = 0;
