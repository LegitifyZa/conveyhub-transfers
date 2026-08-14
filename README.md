# Legitify Convey Hub

A modern, production-ready web application for conveyancing and legal document management, built with **React, TypeScript, Vite, and Tailwind CSS** on the frontend and **Python, FastAPI, and asyncpg** on the backend.

## Features

- **Modern Tech Stack**: React 18, TypeScript, Vite, Tailwind CSS
- **Python/FastAPI Backend**: Async API powered by FastAPI and asyncpg
- **Enterprise UI**: Clean, professional design with dark/light mode support
- **Component-Based Architecture**: Reusable UI components with proper TypeScript typing
- **Responsive Design**: Mobile-first approach with responsive layouts
- **Dark Mode**: Built-in dark/light theme toggle
- **Type Safety**: Full TypeScript implementation with strict mode
- **Golden Records Integration**: Search and pre-fill transfer details from existing records

## Pages

- **Dashboard**: Overview with stats, recent cases, and upcoming events
- **Cases**: Manage and track all conveyancing cases
- **Documents**: Document management with file uploads and organization
- **Settings**: User profile and application settings
- **New Transfer**: Golden records search and transfer creation
- **Bonds**: Bond management (Coming Soon)
- **Cancellations**: Cancellation tracking (Coming Soon)

## Tech Stack

### Core Technologies
- **React 18** - UI framework with hooks and modern features
- **TypeScript** - Type-safe JavaScript development
- **Vite** - Fast build tool and development server
- **Tailwind CSS** - Utility-first CSS framework
- **Python 3.12+** - Backend runtime
- **FastAPI** - Modern, high-performance Python web framework
- **Uvicorn** - ASGI server for running FastAPI
- **asyncpg** - High-performance PostgreSQL driver for Python

### Additional Libraries
- **React Router DOM** - Client-side routing
- **Lucide React** - Beautiful icon library
- **clsx & tailwind-merge** - Utility for conditional CSS classes
- **dotenv** - Environment variable management
- **httpx, python-dateutil, python-multipart** - Supporting Python utilities

### Data Layer
- **Database**: PostgreSQL with asyncpg connection pooling
- **Migrations**: SQL schema management
- **Services**: FastAPI routers for business logic
- **Hooks**: React state management with data persistence

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn package manager
- Python 3.12 or higher
- PostgreSQL 12+ (for database features)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd legitify-convey-hub
```

2. Install Node.js dependencies:
```bash
npm install
```

3. Set up the Python virtual environment and install backend dependencies:

**Windows:**
```powershell
cd python_server
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
cd ..
```

**macOS/Linux:**
```bash
cd python_server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

4. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

5. Set up the database:
```bash
npm run setup:db
npm run migrate
```

6. Start the Python API server:
```bash
cd python_server
.venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 3000
```

Or using the built-in entry point with auto-reload:
```bash
cd python_server
.venv\Scripts\python main.py
```

7. In a second terminal, start the Vite development client:
```bash
npm run dev:client
```

8. Open your browser and navigate to `http://localhost:5173`

### Build for Production

```bash
npm run build
```

The built client files will be in the `dist` directory.

### Linting

```bash
npm run lint
```

To automatically fix linting issues:

```bash
npm run lint:fix
```

### Database Setup

For full functionality with database features:

1. **Install PostgreSQL** (if not already installed):
```bash
# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib

# macOS
brew install postgresql

# Windows
# Download from https://www.postgresql.org/download/windows/
```

2. **Create Database**:
```bash
sudo -u postgres psql
CREATE DATABASE legitify_convey_hub;
CREATE USER legitify_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE legitify_convey_hub TO legitify_user;
\q
```

3. **Run Migrations**:
```bash
npm run migrate
```

4. **Test Connection**:
```bash
npm run test:db
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# PostgreSQL Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=legitify_convey_hub
DB_USER=your_username
DB_PASSWORD=your_password
DB_SSL=false
DB_SCHEMA=Transfers

# Database Connection Pool Settings
DB_MIN_CONNECTIONS=2
DB_MAX_CONNECTIONS=10

# Application Configuration
NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000/api
VITE_API_BASE_URL=/api
VITE_API_PORT=3000

# Loqate Address Verification API
LOQATE_API_KEY=your_loqate_key
```

The Python backend uses the same `.env` file and is configured in `python_server/db.py`.

**Note**: Never commit the `.env` file to version control.

## Project Structure

```
python_server/              # Python/FastAPI backend
├── main.py                 # FastAPI application and middleware
├── db.py                   # asyncpg pool and query helpers
├── requirements.txt        # Python dependencies
├── utils/                  # Python validation utilities
│   ├── __init__.py
│   └── validate.py
└── routers/                # FastAPI route modules
    ├── address.py
    ├── clauses.py
    ├── document_catalogue.py
    ├── documents.py
    ├── generated_documents.py
    ├── health.py
    ├── milestones.py
    ├── template_data_fields.py
    ├── transfers.py
    └── users.py

src/                        # React/TypeScript frontend
├── components/
│   ├── ui/                 # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   └── index.ts
│   ├── DatabaseStatus.tsx  # Database connection status
│   └── transfers/          # Transfer workflow components
│       ├── StepProperty.tsx
│       ├── StepParties.tsx
│       └── TransferForm.tsx
├── layouts/                # Layout components
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   ├── MainLayout.tsx
│   └── index.ts
├── pages/                  # Page components
│   ├── Dashboard.tsx
│   ├── Cases.tsx
│   ├── Documents.tsx
│   ├── Settings.tsx
│   ├── NewTransfer.tsx
│   ├── Bonds.tsx
│   ├── Cancellations.tsx
│   └── index.ts
├── lib/                    # Data access layer
│   ├── api/               # API layer
│   │   └── transferApi.ts
│   ├── services/          # Business logic services
│   │   ├── transferService.ts
│   │   └── userService.ts
│   ├── utils/             # Database utilities
│   │   └── databaseUtils.ts
│   ├── migrations/         # Database schema migrations
│   │   └── 001_initial_schema.sql
│   ├── database.ts         # Database connection
│   └── types.ts          # Data type definitions
├── hooks/                  # Custom React hooks
│   ├── useDatabase.ts     # Database connection hook
│   └── useTransfers.ts    # Transfer state management
├── utils/                  # Utility functions
│   └── cn.ts              # Class name utility
├── assets/                 # Static assets
├── App.tsx                 # Main app component
├── main.tsx               # App entry point
└── index.css              # Global styles
```

## Data Access Layer

The application uses a layered architecture for data management, providing clean separation between UI, business logic, and data persistence.

### API Layer

**FastAPI Backend**
- **Connection Pooling**: asyncpg pool managed in `python_server/db.py`
- **CORS**: Configured to allow the Vite client in development
- **Routers**: Modular route handlers under `python_server/routers/`
- **Environment**: Secure configuration via `.env` variables

**Key Files**
- `python_server/main.py` - FastAPI app and middleware
- `python_server/db.py` - asyncpg pool, query helper, and transaction wrapper
- `python_server/routers/*.py` - API endpoints

### Frontend Service Layer

**Business Logic Abstraction**
- **Transfer Service**: Handles all transfer-related operations
- **User Service**: Manages user data and authentication
- **API Layer**: Clean interface between UI and backend

**Key Files**
- `src/lib/services/transferService.ts` - Transfer business logic
- `src/lib/services/userService.ts` - User management
- `src/lib/api/transferApi.ts` - API interface layer

### React Hooks Layer

**State Management**
- **useDatabase**: Database connection status and queries
- **useTransfers**: Transfer workflow state management
- **Type Safety**: All hooks return typed data

**Key Files**
- `src/hooks/useDatabase.ts` - Database connection hook
- `src/hooks/useTransfers.ts` - Transfer state management

### Data Flow

```
UI Components → React Hooks → Service Layer → FastAPI Router → asyncpg → PostgreSQL
     ↓              ↓              ↓              ↓              ↓            ↓
User Actions → State Updates → Business Logic → Validation → SQL Queries → Data
```

### Golden Records Integration

**Search Functionality**
- **Inline Search**: ID number, name, or registration number search on the New Transfer page
- **Mock Data**: Pre-populated golden records for testing
- **Pre-population**: Auto-fills transfer forms with found records
- **Manual Entry**: Passes the search term into the workflow when no record is found

**Key Components**
- `src/pages/NewTransfer.tsx` - Golden records search and transfer creation page
- `src/components/transfers/StepParties.tsx` - Pre-fills party details from a Golden Record

### Database Schema

**Core Tables**
- **users**: User accounts and profiles
- **transfers**: Property transfer records
- **parties**: Buyer/seller information
- **documents**: File attachments and metadata
- **audit_trail**: Change tracking and compliance

## Design System

### Color Palette

- **Primary**: Navy blue (`navy-600`, `navy-700`)
- **Accent**: Teal (`teal-500`, `teal-600`)
- **Neutral**: Gray scale for text and backgrounds
- **Semantic**: Colors for status, success, warning, error states

### Typography

- **Font Family**: Inter (system-ui fallback)
- **Font Weights**: 300, 400, 500, 600, 700
- **Responsive**: Scales properly across device sizes

### Components

All UI components follow these principles:
- Consistent design patterns
- Proper TypeScript typing
- Accessibility considerations
- Dark mode support
- Responsive behavior

## Development Guidelines

### Component Development

1. Use TypeScript for all components
2. Follow the existing naming conventions
3. Implement proper props interfaces
4. Use the `cn` utility for conditional classes
5. Ensure dark mode compatibility

### Code Style

- Use ES6+ features
- Follow React best practices
- Implement proper error boundaries
- Use semantic HTML elements
- Maintain consistent indentation

### Performance

- Lazy load routes when needed
- Optimize bundle size
- Use React.memo for expensive components
- Implement proper loading states

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support and questions, please contact the development team or create an issue in the repository.
