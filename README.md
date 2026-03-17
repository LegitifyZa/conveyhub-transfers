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

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn package manager

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

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

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

## Project Structure

```
src/
├── components/
│   └── ui/                 # Reusable UI components
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Input.tsx
│       └── index.ts
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
│   └── index.ts
├── hooks/                  # Custom React hooks
├── services/               # API services and utilities
├── utils/                  # Utility functions
│   └── cn.ts              # Class name utility
├── types/                  # TypeScript type definitions
├── assets/                 # Static assets
├── App.tsx                 # Main app component
├── main.tsx               # App entry point
└── index.css              # Global styles
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
