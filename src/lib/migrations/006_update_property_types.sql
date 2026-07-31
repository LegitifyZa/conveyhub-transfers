-- Update property type options to match the conveyancing application

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  WHERE con.conrelid = 'properties'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%property_type%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE properties DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE properties
SET property_type = 'Freehold'
WHERE property_type NOT IN (
  'Freehold', 'Sectional Title', 'Share Block', 'Life Rights',
  'Agricultural Holding', 'Farm', 'Commercial', 'Mixed Use', 'Vacant Land'
);

ALTER TABLE properties ADD CONSTRAINT check_property_type
    CHECK (property_type IN (
      'Freehold', 'Sectional Title', 'Share Block', 'Life Rights',
      'Agricultural Holding', 'Farm', 'Commercial', 'Mixed Use', 'Vacant Land'
    ));
