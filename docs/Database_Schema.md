# Legitify ConveyHub - Database Schema Documentation

## Overview

The Legitify ConveyHub database uses PostgreSQL with a comprehensive schema designed for conveyancing workflow management. The schema supports user management, property registration, property transfers, document handling, and complete audit trails.

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

### 2. Properties Table

**Purpose**: Manages property registration and details

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Property unique identifier |
| property_id | VARCHAR(50) | UNIQUE, NOT NULL | Business property ID (PROP-YYYY-XXXX) |
| erf_number | VARCHAR(50) | | ERF (Erfelijk) number |
| street_address | TEXT | NOT NULL | Property street address |
| suburb | VARCHAR(100) | | Property suburb |
| city | VARCHAR(100) | NOT NULL | Property city |
| postal_code | VARCHAR(10) | | South African postal code |
| province | VARCHAR(50) | NOT NULL | Property province |
| country | VARCHAR(50) | DEFAULT 'South Africa' | Property country |
| property_type | VARCHAR(50) | NOT NULL, CHECK | Property type |
| title_deed_number | VARCHAR(100) | | Title deed reference |
| survey_general_number | VARCHAR(100) | | Survey general number |
| extent_sqm | DECIMAL(10,2) | | Property extent in square meters |
| zoning | VARCHAR(50) | | Municipal zoning |
| rates_number | VARCHAR(50) | | Municipal rates number |
| municipal_valuation | DECIMAL(12,2) | | Municipal property valuation |
| year_built | INTEGER | | Year property was built |
| bedrooms | INTEGER | | Number of bedrooms |
| bathrooms | INTEGER | | Number of bathrooms |
| garages | INTEGER | | Number of garages |
| parking_spaces | INTEGER | | Number of parking spaces |
| swimming_pool | BOOLEAN | DEFAULT FALSE | Has swimming pool |
| security_features | TEXT | | Security features description |
| description | TEXT | | Property description |
| latitude | DECIMAL(10,8) | | GPS latitude |
| longitude | DECIMAL(11,8) | | GPS longitude |
| status | VARCHAR(50) | DEFAULT 'active', CHECK | Property status |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update time |

**Property Type Values**: `residential`, `commercial`, `industrial`, `agricultural`, `vacant_land`

**Status Values**: `active`, `inactive`, `sold`, `under_offer`, `suspended`

**Indexes**:
- `idx_properties_property_id` - Business ID lookup
- `idx_properties_street_address` - Address search
- `idx_properties_suburb` - Suburb filtering
- `idx_properties_city` - City filtering
- `idx_properties_postal_code` - Postal code lookup
- `idx_properties_property_type` - Type filtering
- `idx_properties_status` - Status filtering
- `idx_properties_created_at` - Time-based queries
- `idx_properties_lat_lng` - Geospatial queries

### 3. Transfers Table

**Purpose**: Core entity for property transfer workflows

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Transfer unique identifier |
| transfer_id | VARCHAR(50) | UNIQUE, NOT NULL | Business transfer ID (TRF-YYYY-XXXX) |
| property_id | UUID | FOREIGN KEY → properties.id | Associated property |
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
- `idx_transfers_property_id` - Property lookup
- `idx_transfers_status` - Status filtering
- `idx_transfers_created_at` - Time-based queries
- `idx_transfers_updated_at` - Update tracking
- `idx_transfers_purchase_price` - Financial queries

### 4. Parties Table

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

### 5. Documents Table

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

### 6. Audit Log Table

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

### 1. Property ID Generation
```sql
generate_property_id() -> TEXT
```
Generates unique property IDs in format: PROP-YYYY-XXXX

### 2. Transfer ID Generation
```sql
generate_transfer_id() -> TEXT
```
Generates unique transfer IDs in format: TRF-YYYY-XXXX

### 3. Progress Calculation
```sql
calculate_transfer_progress(current_step, total_steps) -> INTEGER
```
Calculates percentage completion

### 4. SA ID Validation
```sql
validate_sa_id_number(id_number) -> BOOLEAN
```
Validates South African ID number format

### 5. SA Postal Code Validation
```sql
validate_sa_postal_code(postal_code) -> BOOLEAN
```
Validates South African postal code format (4 digits)

### 6. Transfer Statistics
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

### 1. Property Details
Aggregated property data with transfer counts and last transfer date

### 2. Transfer Summary
Aggregated transfer data with party and document counts

### 3. Party Details
Party information with associated transfer context

### 4. Document Details
Document information with transfer context

## Performance Considerations

### Indexing Strategy
- Primary keys: UUID indexes
- Foreign keys: Referential integrity indexes
- Search columns: Email, name, status indexes
- Geospatial: Latitude/longitude composite index
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
- Postal code format validation
- Email format constraints
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

## Property Features

### Geospatial Support
- Latitude/longitude coordinates
- Mapping integration ready
- Location-based queries

### South African Specific
- ERF numbers (Erfelijk)
- Title deed references
- Survey general numbers
- Municipal integration

### Comprehensive Attributes
- Detailed property characteristics
- Room counts and amenities
- Security features
- Municipal valuations
