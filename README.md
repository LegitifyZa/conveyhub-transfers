# Legitify Convey Hub

A modern, production-ready web application for conveyancing and legal document management, built with React, TypeScript, and Tailwind CSS.

## Features

- **Modern Tech Stack**: React 18, TypeScript, Vite, Tailwind CSS
- **Enterprise UI**: Clean, professional design with dark/light mode support
- **Component-Based Architecture**: Reusable UI components with proper TypeScript typing
- **Responsive Design**: Mobile-first approach with responsive layouts
- **Dark Mode**: Built-in dark/light theme toggle
- **Type Safety**: Full TypeScript implementation with strict mode

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

### Additional Libraries
- **React Router DOM** - Client-side routing
- **Lucide React** - Beautiful icon library
- **clsx & tailwind-merge** - Utility for conditional CSS classes
- **PostgreSQL (pg)** - Database connectivity
- **dotenv** - Environment variable management

### Data Layer
- **Database**: PostgreSQL with connection pooling
- **Migrations**: SQL schema management
- **Services**: Business logic abstraction
- **Hooks**: React state management with data persistence

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn package manager
- PostgreSQL 12+ (for database features)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd legitify-convey-hub
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

4. Set up database:
```bash
npm run migrate
```

5. Start development server:
```bash
npm run dev
```

6. Open your browser and navigate to `http://localhost:5173`

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

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
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=legitify_convey_hub
DB_USER=postgres
DB_PASSWORD=your_password

# Application Configuration
VITE_API_URL=http://localhost:3000
VITE_APP_NAME=Legitify ConveyHub
```

**Note**: Never commit the `.env` file to version control.

## Project Structure

```
src/
├── components/
│   ├── ui/                 # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   └── index.ts
│   ├── DatabaseStatus.tsx  # Database connection status
│   ├── GoldenRecordsSearch.tsx # Golden records search modal
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

### Database Layer

**PostgreSQL Integration**
- **Connection**: Managed connection pooling with `pg` library
- **Environment**: Secure configuration via `.env` variables
- **Migrations**: Version-controlled schema management
- **Type Safety**: Full TypeScript integration

**Key Files**
- `src/lib/database.ts` - Database connection and pool management
- `src/lib/migrations/` - SQL schema files
- `.env` - Database credentials (never committed)

### Service Layer

**Business Logic Abstraction**
- **Transfer Service**: Handles all transfer-related operations
- **User Service**: Manages user data and authentication
- **API Layer**: Clean interface between UI and database

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
UI Components → React Hooks → Service Layer → Database
     ↓              ↓              ↓           ↓
User Actions → State Updates → Business Logic → SQL Queries
```

### Golden Records Integration

**Search Functionality**
- **Modal Interface**: User-friendly search component
- **Mock Data**: Pre-populated golden records for testing
- **Pre-population**: Auto-fills transfer forms with found records
- **Skip Option**: Users can bypass search if needed

**Key Components**
- `GoldenRecordsSearch.tsx` - Search modal component
- `NewTransfer.tsx` - Integration page for golden records

### Database Schema

**Core Tables**
- **users**: User accounts and profiles
- **transfers**: Property transfer records
- **parties**: Buyer/seller information
- **documents**: File attachments and metadata
- **audit_trail**: Change tracking and compliance

### Environment Configuration

**Required Variables**
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=legitify_convey_hub
DB_USER=postgres
DB_PASSWORD=your_password
```

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
