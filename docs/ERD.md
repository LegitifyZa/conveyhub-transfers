# Legitify ConveyHub - Entity Relationship Diagram (ERD)

## Core Tables

### Users
```
users (UUID PK)
├── id (UUID, PK)
├── email (VARCHAR, UNIQUE)
├── name (VARCHAR)
├── role (ENUM: admin|user|conveyancer)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

### Transfers
```
transfers (UUID PK)
├── id (UUID, PK)
├── transfer_id (VARCHAR, UNIQUE)
├── property_address (TEXT)
├── purchase_price (DECIMAL)
├── transfer_duty (DECIMAL)
├── conveyancing_fees (DECIMAL)
├── deeds_office_fees (DECIMAL)
├── vat (DECIMAL)
├── total_costs (DECIMAL)
├── status (ENUM: draft|in_progress|completed|cancelled)
├── current_step (INTEGER)
├── total_steps (INTEGER)
├── progress (INTEGER)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

### Parties
```
parties (UUID PK)
├── id (UUID, PK)
├── transfer_id (UUID, FK→transfers.id)
├── name (VARCHAR)
├── type (ENUM: buyer|seller)
├── id_number (VARCHAR, SA ID format)
├── registration_number (VARCHAR)
├── email (VARCHAR)
├── phone (VARCHAR)
├── address (TEXT)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

### Documents
```
documents (UUID PK)
├── id (UUID, PK)
├── transfer_id (UUID, FK→transfers.id)
├── name (VARCHAR)
├── file_path (TEXT)
├── file_size (INTEGER)
├── file_type (VARCHAR)
├── category (VARCHAR)
├── status (ENUM: pending|uploaded|verified|rejected)
├── uploaded_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

### Audit Log
```
audit_log (UUID PK)
├── id (UUID, PK)
├── table_name (VARCHAR)
├── record_id (UUID)
├── action (ENUM: INSERT|UPDATE|DELETE)
├── old_values (JSONB)
├── new_values (JSONB)
├── user_id (UUID, FK→users.id)
└── timestamp (TIMESTAMP)
```

## Relationships

```
users (1) ──────── (∞) audit_log
  │
  │
transfers (1) ──── (∞) parties
  │                   │
  │                   └─── (1) users (via audit)
  │
  └─── (∞) documents
```

## Key Features

### Constraints
- UUID primary keys
- Foreign key cascading deletes
- Check constraints for enums
- SA ID number validation

### Triggers
- Auto-updated_at timestamps
- Progress calculation on step change
- Audit logging for all changes

### Views
- transfer_summary (with counts)
- party_details (with transfer info)
- document_details (with transfer info)

### Indexes
- Performance indexes on foreign keys
- Search indexes on email, name, status
- Time-based indexes on timestamps
