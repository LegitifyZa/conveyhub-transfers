BEGIN;

SET LOCAL search_path TO transfers, public;

CREATE OR REPLACE FUNCTION public.generate_transfer_id()
RETURNS TEXT AS $$
DECLARE
    v_year_part TEXT;
    v_timestamp_part TEXT;
    v_random_part TEXT;
    v_transfer_id TEXT;
BEGIN
    v_year_part := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    v_timestamp_part := EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::TEXT;
    v_random_part := LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');
    v_transfer_id := 'TRF-' || v_year_part || '-' || SUBSTRING(v_timestamp_part, -6) || '-' || v_random_part;

    WHILE EXISTS (
        SELECT 1 FROM transfers.transfers
        WHERE transfers.transfers.transfer_id = v_transfer_id
    ) LOOP
        v_random_part := LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');
        v_transfer_id := 'TRF-' || v_year_part || '-' || SUBSTRING(v_timestamp_part, -6) || '-' || v_random_part;
    END LOOP;

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
