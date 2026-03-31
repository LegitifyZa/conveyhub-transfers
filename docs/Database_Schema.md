# Legitify ConveyHub - Database Schema Documentation

## Overview

The Legitify ConveyHub database uses PostgreSQL with a comprehensive schema designed for conveyancing workflow management. The schema supports user management, property transfers, document handling, and complete audit trails.

## Core Tables

### 1. Users Table

**Purpose**: Manages user accounts and authentication

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique user identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | User email address |
| name | VARCHAR(255) | NOT NULL | User full name |
| role | VARCHAR(50) | DEFAULT 'user', CHECK | User role (admin/user/conveyancer) |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Account creation time |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update time |

**Indexes**:
- `idx_users_email` - Email lookup
- `idx_users_role` - Role filtering
- `idx_users_created_at` - Time-based queries

### 2. Transfers Table

**Purpose**: Core entity for property transfer workflows

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Transfer unique identifier |
| transfer_id | VARCHAR(50) | UNIQUE, NOT NULL | Business transfer ID (TRF-YYYY-XXXX) |
| property_address | TEXT | NOT NULL | Property full address |
| purchase_price | DECIMAL(12,2) | NOT NULL | Property purchase price |
| transfer_duty | DECIMAL(12,2) | | Government transfer duty |
| conveyancing_fees | DECIMAL(12,2) | | Professional fees |
| deeds_office_fees | DECIMAL(12,2) | | Deeds office charges |
| vat | DECIMAL(12,2) | | VAT on fees |
| total_costs | DECIMAL(12,2) | | Total transfer costs |
| status | VARCHAR(50) | DEFAULT 'draft', CHECK | Transfer status |
| current_step | INTEGER | DEFAULT 1 | Current workflow step |
| total_steps | INTEGER | DEFAULT 5 | Total workflow steps |
| progress | INTEGER | DEFAULT 0 | Progress percentage |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update time |

**Status Values**: `draft`, `in_progress`, `completed`, `cancelled`

**Indexes**:
- `idx_transfers_transfer_id` - Business ID lookup
- `idx_transfers_status` - Status filtering
- `idx_transfers_created_at` - Time-based queries
- `idx_transfers_updated_at` - Update tracking
- `idx_transfers_purchase_price` - Financial queries

### 3. Parties Table

**Purpose**: Manages buyers, sellers, and other parties involved in transfers

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Party unique identifier |
| transfer_id | UUID | FOREIGN KEY → transfers.id | Associated transfer |
| name | VARCHAR(255) | NOT NULL | Party full name |
| type | VARCHAR(50) | NOT NULL, CHECK | Party type (buyer/seller) |
| id_number | VARCHAR(13) | | South African ID number |
| registration_number | VARCHAR(50) | | Business registration |
| email | VARCHAR(255) | | Contact email |
| phone | VARCHAR(50) | | Contact phone |
| address | TEXT | | Physical address |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update time |

**Type Values**: `buyer`, `seller`

**Constraints**:
- SA ID number validation (13 digits)
- Foreign key cascade delete

**Indexes**:
- `idx_parties_transfer_id` - Transfer lookup
- `idx_parties_type` - Party type filtering
- `idx_parties_name` - Name search
- `idx_parties_id_number` - ID lookup
- `idx_parties_email` - Email lookup

### 4. Documents Table

**Purpose**: Manages document uploads and metadata

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Document unique identifier |
| transfer_id | UUID | FOREIGN KEY → transfers.id | Associated transfer |
| name | VARCHAR(255) | NOT NULL | Document name |
| file_path | TEXT | | File storage path |
| file_size | INTEGER | | File size in bytes |
| file_type | VARCHAR(100) | | MIME type |
| category | VARCHAR(100) | | Document category |
| status | VARCHAR(50) | DEFAULT 'pending', CHECK | Processing status |
| uploaded_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Upload time |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update time |

**Status Values**: `pending`, `uploaded`, `verified`, `rejected`

**Indexes**:
- `idx_documents_transfer_id` - Transfer lookup
- `idx_documents_status` - Status filtering
- `idx_documents_category` - Category filtering
- `idx_documents_uploaded_at` - Time-based queries

### 5. Audit Log Table

**Purpose**: Complete audit trail for compliance and debugging

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Audit entry unique identifier |
| table_name | VARCHAR(50) | NOT NULL | Modified table name |
| record_id | UUID | NOT NULL | Modified record ID |
| action | VARCHAR(20) | NOT NULL, CHECK | Action type |
| old_values | JSONB | | Previous state |
| new_values | JSONB | | New state |
| user_id | UUID | FOREIGN KEY → users.id | User who made change |
| timestamp | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Change time |

**Action Values**: `INSERT`, `UPDATE`, `DELETE`

**Indexes**:
- `idx_audit_log_table_name` - Table filtering
- `idx_audit_log_record_id` - Record lookup
- `idx_audit_log_action` - Action filtering
- `idx_audit_log_timestamp` - Time-based queries
- `idx_audit_log_user_id` - User lookup

## Database Functions

### 1. Transfer ID Generation
```sql
generate_transfer_id() -> TEXT
```
Generates unique transfer IDs in format: TRF-YYYY-XXXX

### 2. Progress Calculation
```sql
calculate_transfer_progress(current_step, total_steps) -> INTEGER
```
Calculates percentage completion

### 3. SA ID Validation
```sql
validate_sa_id_number(id_number) -> BOOLEAN
```
Validates South African ID number format

### 4. Transfer Statistics
```sql
get_transfer_statistics() -> JSON
```
Returns aggregated transfer statistics

## Database Triggers

### 1. Auto-updated_at
Updates `updated_at` timestamp on record modifications

### 2. Progress Calculation
Automatically calculates transfer progress when step changes

### 3. Audit Logging
Creates audit entries for all INSERT/UPDATE/DELETE operations

## Database Views

### 1. Transfer Summary
Aggregated transfer data with party and document counts

### 2. Party Details
Party information with associated transfer context

### 3. Document Details
Document information with transfer context

## Performance Considerations

### Indexing Strategy
- Primary keys: UUID indexes
- Foreign keys: Referential integrity indexes
- Search columns: Email, name, status indexes
- Time columns: Created/updated timestamps

### Query Optimization
- Views for common complex queries
- Functions for reusable calculations
- Triggers for automated data maintenance

### Data Integrity
- Foreign key constraints with cascade deletes
- Check constraints for enum values
- Unique constraints for business keys
- Custom validation functions

## Security Features

### Audit Trail
- Complete change tracking
- User attribution for all changes
- Before/after state capture
- Immutable audit logs

### Data Validation
- SA ID number format validation
- Email format constraints
- Enum value restrictions
- Required field enforcement

## Migration Strategy

### Version Control
- Sequential migration files
- Rollback capabilities
- Schema version tracking
- Automated deployment

### Data Migration
- Zero-downtime migrations
- Backward compatibility
- Data transformation support
- Validation checks
