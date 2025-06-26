# Juris Kit 🚀

A powerful, lightweight SSR (Server-Side Rendering) framework with built-in state management, routing, and component system. Juris Kit makes building reactive full-stack applications simple and enjoyable.

[![npm version](https://img.shields.io/npm/v/@jurisjs/juris-kit.svg)](https://www.npmjs.com/package/@jurisjs/juris-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/@jurisjs/juris-kit.svg)](https://nodejs.org)

## Features ✨

- **🎯 True SSR** - Server-side rendering out of the box with automatic hydration
- **⚡ Lightning Fast** - Built on Fastify for maximum performance
- **🔄 Reactive State Management** - Built-in state management with automatic re-renders
- **🛣️ Smart Routing** - File-based and programmatic routing with SSR support
- **🧩 Component System** - Simple, powerful component architecture
- **📦 Zero Config** - Works out of the box with sensible defaults
- **🔧 Fully Configurable** - Extensive configuration options when you need them
- **🚀 Production Ready** - Compression, caching, security headers included
- **🔥 Hot Reload** - Development server with automatic rebuilding
- **📱 SEO Friendly** - Full SSR support for better SEO

## Quick Start 🏃‍♂️

### Installation

```bash
npm install @jurisjs/juris-kit
```

### Create a New Project

```bash
npx juris init my-app
cd my-app
npm install
```

### Start Development Server

```bash
npm run dev
# or
npx juris dev
```

Your app will be running at `http://localhost:3000` 🎉

## Project Structure 📁

```
my-app/
├── juris/                 # Core framework files
│   ├── juris.js          # Main Juris library
│   └── server.js         # Server implementation
├── source/               # Your application code
│   ├── components/       # Reusable components
│   ├── layouts/          # Layout components
│   ├── pages/            # Page components
│   └── app.js           # App entry point
├── public/              # Static assets
│   ├── css/            # Stylesheets
│   └── js/             # Client-side scripts
├── scripts/             # Build scripts
├── config/              # Configuration files
├── server.js            # Server entry point
└── juris.config.js      # Main configuration
```

## Basic Usage 💻

### 1. Create a Component

```javascript
// source/components/Counter.js
const Counter = {
	state: ["counter"],

	increment() {
		this.setState("counter", this.state.counter + 1);
	},

	render() {
		return {
			div: {
				children: [
					{ h2: { text: `Count: ${this.state.counter}` } },
					{
						button: {
							text: "Increment",
							onClick: () => this.increment(),
						},
					},
				],
			},
		};
	},
};
```

### 2. Create a Page

```javascript
// source/pages/HomePage.js
const HomePage = {
	render() {
		return {
			div: {
				class: "home-page",
				children: [{ h1: { text: "Welcome to Juris!" } }, { Counter: {} }],
			},
		};
	},
};
```

### 3. Configure Your App

```javascript
// juris.config.js
module.exports = {
	server: {
		port: 3000,
		host: "0.0.0.0",
	},
	app: {
		title: "My Juris App",
		initialState: {
			counter: 0,
		},
	},
};
```

## Configuration 🔧

Juris Kit uses a powerful configuration system via `juris.config.js`:

```javascript
module.exports = {
	// Server configuration
	server: {
		port: process.env.PORT || 3000,
		host: "0.0.0.0",
		fastify: {
			logger: true,
			// All Fastify options...
		},
	},

	// Application settings
	app: {
		title: "My App",
		meta: {
			// SEO meta tags
		},
		initialState: {
			// Initial application state
		},
	},

	// Static file serving
	static: {
		public: {
			root: "public",
			prefix: "/public/",
			cache: {
				maxAge: "1d",
			},
		},
	},

	// Routing configuration
	routes: {
		pages: {
			"/": { title: "Home" },
			"/about": { title: "About" },
		},
	},

	// And much more...
};
```

## CLI Commands 🛠️

```bash
# Start production server
juris start

# Start development server with hot reload
juris dev

# Build your application
juris build

# Create new project
juris init [project-name]

# Show current configuration
juris config
```

## Advanced Features 🚀

### State Management

```javascript
// Global state management
const app = createApp({
	states: {
		user: { name: "Guest", isLoggedIn: false },
		todos: [],
	},
});

// Access state in components
const UserProfile = {
	state: ["user"],
	render() {
		return {
			div: {
				text: `Hello, ${this.state.user.name}!`,
			},
		};
	},
};
```

### Routing

```javascript
// Headless router component
const SimpleRouter = {
	routes: {
		"/": HomePage,
		"/about": AboutPage,
		"/todos": TodosPage,
		"/user/:id": UserPage,
	},
};
```

### Lifecycle Hooks

```javascript
// juris.config.js
module.exports = {
	hooks: {
		beforeServerStart: async (fastify, config) => {
			// Initialize services
		},
		beforeRender: async (app, route, config) => {
			// Modify app state before SSR
		},
		afterRender: async (html, state, route, config) => {
			// Transform HTML after rendering
			return { html, state };
		},
	},
};
```

## API Reference 📚

### JurisServer

```javascript
const { JurisServer } = require("@jurisjs/juris-kit");

const server = new JurisServer("./custom-config.js");
await server.start();
```

### createApp

```javascript
const { createApp } = require("@jurisjs/juris-kit");

const app = createApp({
	states: {
		/* initial state */
	},
	components: {
		/* components */
	},
	layout: {
		/* layout definition */
	},
});
```

## Performance 🏎️

Juris Kit is built for speed:

- ⚡ Sub-millisecond hydration times
- 🚀 Fastify-powered server (30k+ requests/sec)
- 📦 Automatic code splitting
- 🗜️ Built-in compression
- 💾 Smart caching strategies
- 🔄 Efficient re-rendering

## Production Deployment 🌐

```bash
# Build for production
npm run build

# Start production server
NODE_ENV=production npm start
# or
juris start --production
```

### Docker Support

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## Contributing 🤝

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License 📄

MIT © [Juris Team]

## Support 💬

- 📖 [Documentation](https://jurisjs.org/docs)
- 💬 [Discord Community](https://discord.gg/jurisjs)
- 🐛 [Issue Tracker](https://github.com/jurisjs/juris-kit/issues)
- 🐦 [Twitter](https://twitter.com/jurisjs)

---

Made with ❤️ by the Juris Team
