# Juris Kit

[![NPM Version](https://img.shields.io/npm/v/juris.svg)](https://www.npmjs.com/package/juris)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Performance](https://img.shields.io/badge/Performance-1300%2B%20req%2Fs-green.svg)](#performance)

> **Complete Starter Kit for Juris Framework**  
> Full-stack reactive JavaScript framework with SSR, API routes, and static generation

## 🚀 Quick Start

```bash
# Clone the Juris Kit
git clone https://github.com/jurisjs/juris-kit.git my-app
cd my-app
npm install

# Start development server
npm run dev

# Or start production server
npm start
```

Visit `http://localhost:3000` and you're ready to build!

## 📦 What's Included

**Juris Kit** provides everything you need to build modern web applications with the Juris framework:

### 🏗️ **Complete Project Structure**
```
juris-kit/
├── config/
│   └── juris.config.js         # Server & build configuration
├── public/
│   ├── css/styles.css          # Stylesheets
│   └── js/juris-app.js         # Client-side bundle
├── source/
│   ├── components/             # Reusable UI components
│   ├── headless/               # Logic components (API, routing, etc.)
│   ├── pages/                  # Page components
│   └── app.js                  # Main application entry
├── services/
│   └── db.query.js            # Database/API services
└── server.js                  # Production server
```

### ⚡ **Built-in Features**
- **🔄 Full Async/Await Support** - Native promise handling throughout the stack
- **🌐 Universal API Client** - Seamless server-client API integration
- **💧 Smart Hydration** - Efficient client-side takeover from SSR
- **🚀 High Performance** - 1,300+ req/s with 9.6ms response times
- **📡 Server-Side Rendering (SSR)** - Fast initial page loads with hydration
- **🔗 RESTful API Routes** - Built-in endpoints with automatic routing
- **⚡ Static Site Generation** - Pre-render pages for maximum performance
- **🔥 Hot Reloading** - Instant development feedback
- **📦 Compression** - Gzip compression for production
- **🌍 CORS Support** - Ready for cross-origin requests

### 🎯 **Pre-configured Components**
- **Router** - Client-side navigation
- **API Client** - Universal fetch client (server + browser)
- **String Renderer** - HTML generation for SSR
- **Swap Attributes** - Dynamic content updates

## 🎨 Example Application

The kit comes with a complete example showing all async, API, performance, and hydration features:

### Async Component with Error Handling
```javascript
// source/components/AsyncUserProfile.js
const AsyncUserProfile = async (props, context) => {
  const { getState, setState } = context;
  
  try {
    // Async data loading with loading states
    setState('user.loading', true);
    const userData = await fetch(`/api/users/${props.userId}`);
    const user = await userData.json();
    
    setState('user.data', user);
    setState('user.error', null);
    
    return {
      div: { className: 'user-profile',
        children: [
          { img: { src: user.avatar, alt: user.name }},
          { h2: { text: user.name }},
          { p: { text: `${user.posts} posts • ${user.followers} followers` }}
        ]
      } //div.user-profile
    }; //return
    
  } catch (error) {
    setState('user.error', error.message);
    setState('user.loading', false);
    
    return {
      div: { className: 'error',
        text: 'Failed to load user profile'
      }
    };
  } finally {
    setState('user.loading', false);
  }
};
```

### Universal API Client
```javascript
// source/headless/APIClient.js
const APIClient = (props, context) => {
  const { getState, setState } = context;
  
  return {
    api: {
      // Works on both server and client automatically
      async fetchWithCache(endpoint, options = {}) {
        const cacheKey = `api.cache.${endpoint}`;
        
        // Check cache first
        if (!options.skipCache) {
          const cached = getState(cacheKey);
          if (cached && Date.now() - cached.timestamp < 300000) {
            return cached.data;
          }
        }
        
        // Set loading state
        setState(`api.${endpoint}.loading`, true);
        
        try {
          // Universal fetch - works on server and client
          const response = await fetch(`/api${endpoint}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const data = await response.json();
          
          // Cache the result
          setState(cacheKey, { data, timestamp: Date.now() });
          setState(`api.${endpoint}.data`, data);
          setState(`api.${endpoint}.error`, null);
          
          return data;
          
        } catch (error) {
          setState(`api.${endpoint}.error`, error.message);
          throw error;
        } finally {
          setState(`api.${endpoint}.loading`, false);
        }
      },
      
      // High-performance batch operations
      async batchRequest(endpoints) {
        const promises = endpoints.map(endpoint => 
          this.fetchWithCache(endpoint, { skipCache: true })
        );
        return await Promise.all(promises);
      }
    }
  };
};
```

### Smart Hydration Example
```javascript
// source/pages/HomePage.js - Hydration-aware component
const HomePage = (props, context) => {
  const { getState, setState } = context;
  
  // Check if we're hydrating from server-side render
  const isHydrating = getState('isHydration', false);
  
  return {
    div: { className: 'home-page',
      children: [
        { h1: { text: 'Welcome to Juris Kit!' }},
        
        // Conditional rendering based on hydration state
        isHydrating ? 
          // Server-side: render immediately with data
          { div: { text: () => `Server time: ${getState('serverTime')}` }} :
          // Client-side: async load fresh data
          { AsyncTimeDisplay: {} },
          
        // Performance-optimized component loading
        { LazyCounter: { 
          // Only loads when visible (intersection observer)
          loadWhen: 'visible',
          fallback: { div: { text: 'Loading counter...' }}
        }},
        
        // API-integrated navigation
        { nav: {
          children: () => {
            const pages = getState('api.pages.data', []);
            return pages.map(page => ({
              a: { 
                href: page.url, 
                text: page.title,
                // Smart prefetching on hover
                onMouseEnter: () => this.prefetchPage(page.url)
              }
            }));
          }
        }} //nav
      ]
    } //div.home-page
  }; //return
};
```

## ⚙️ Configuration

### Server Configuration with Advanced Features
```javascript
// config/juris.config.js
module.exports = {
  server: {
    port: process.env.PORT || 3000,
    host: '0.0.0.0',
    // High-performance server options
    fastify: {
      keepAliveTimeout: 30000,
      connectionTimeout: 60000,
      maxParamLength: 100
    }
  },
  
  app: {
    title: 'My High-Performance Juris App',
    initialState: {
      // Hydration-ready state
      isHydration: true,
      serverTime: Date.now(),
      api: { cache: {} }
    }
  },
  
  // Advanced API configuration
  api: {
    prefix: '/api',
    cors: { enabled: true, credentials: true },
    rateLimit: { enabled: true, max: 100, timeWindow: '1 minute' },
    
    // High-performance endpoints with caching
    endpoints: {
      '/users': {
        method: 'GET',
        cache: true,
        handler: async (request, reply) => {
          // Async database query with connection pooling
          const users = await db.users.findAll({
            include: ['posts', 'profile'],
            cache: 300 // 5 minutes
          });
          return users;
        }
      },
      
      '/users/:id': {
        method: 'GET',
        cache: true,
        handler: async (request, reply) => {
          const { id } = request.params;
          const user = await db.users.findById(id, {
            include: ['posts', 'comments'],
            cache: 180 // 3 minutes
          });
          if (!user) {
            reply.code(404);
            return { error: 'User not found' };
          }
          return user;
        }
      },
      
      // Async batch endpoint
      '/batch': {
        method: 'POST',
        handler: async (request, reply) => {
          const { requests } = request.body;
          const results = await Promise.allSettled(
            requests.map(req => processAPIRequest(req))
          );
          return { results };
        }
      }
    }
  },
  
  // Smart static generation with async detection
  htmlCache: {
    generation: {
      enabled: true,
      outputDir: 'dist',
      routes: ['/', '/about', '/users'],
      ttl: 300000, // 5 minutes
      onDemand: {
        enabled: true,
        maxFileAge: 300000,
        serveStaleWhileRevalidate: true
      },
      // Only generate truly static routes (no async dependencies)
      detectReactivity: true
    }
  },
  
  // Performance optimizations
  performance: {
    compression: { enabled: true, threshold: 1024 },
    cache: {
      ssrCacheDuration: 3600, // 1 hour
      staticAssetCaching: true
    }
  },
  
  // Advanced hydration settings
  hydration: {
    strategy: 'progressive', // progressive | immediate | lazy
    skipStaticContent: true,
    chunkSize: 50, // Number of components to hydrate per chunk
    priority: ['interactive', 'visible', 'deferred']
  }
};
```

## 🚀 Development Workflow

### 1. **Development Mode**
```bash
npm run dev
# Starts server with hot reloading at http://localhost:3000
```

### 2. **Add New Components**
```bash
# Create new component
touch source/components/MyComponent.js

# Register in app.js
app.registerComponent('MyComponent', MyComponent);
```

### 3. **Add API Endpoints**
```javascript
// In config/juris.config.js
api: {
  endpoints: {
    '/my-endpoint': {
      method: 'POST',
      handler: async (request, reply) => {
        // Your API logic here
        return { success: true };
      }
    }
  }
}
```

### 4. **Build for Production**
```bash
npm run build
npm start
```

### 5. **Generate Static Site**
```bash
npm run generate
# Creates static files in dist/ folder
```

## 📊 Performance & Benchmarks

Juris Kit delivers exceptional performance with advanced async handling:

### **Load Test Results**
```
Artillery Load Test (50,000 requests):
├── 🚀 Requests per second: 1,332 req/s
├── ⚡ Average response time: 9.6ms  
├── 📈 95th percentile: 15ms
├── 🎯 99th percentile: 19.1ms
├── ✅ Success rate: 100% (zero failures)
└── 💾 Memory usage: Stable under load
```

### **Async Performance Features**
- **⚡ Non-blocking Rendering** - UI stays responsive during async operations
- **🔄 Smart Promise Batching** - Automatic promise collection and resolution
- **📦 Intelligent Caching** - API responses cached with TTL
- **🚀 Lazy Loading** - Components load only when needed
- **💧 Hydration Optimization** - Minimal client-side JavaScript execution
- **📡 Prefetching** - Smart resource preloading on user interaction

### **API Performance Optimizations**
```javascript
// Built-in performance features in the kit:

// 1. Request batching
const batchedData = await api.batchRequest(['/users', '/posts', '/comments']);

// 2. Automatic caching with TTL
const userData = await api.fetchWithCache('/users/123'); // Cached for 5 minutes

// 3. Background updates
api.backgroundRefresh('/dashboard'); // Updates cache without blocking UI

// 4. Smart retries with exponential backoff
const result = await api.fetchWithRetry('/api/data', { maxRetries: 3 });
```

### **Hydration Performance**
- **🏎️ Fast Hydration** - Only hydrates interactive components
- **📊 Selective Hydration** - Skip static content during hydration
- **⚡ Progressive Enhancement** - Works without JavaScript, enhanced with it
- **💧 Smart State Transfer** - Efficient server-to-client state synchronization

## 🛠️ Available Scripts

```bash
# Development
npm run dev          # Start dev server with hot reload
npm run watch        # Watch for file changes

# Production  
npm run build        # Build for production
npm start           # Start production server
npm run generate    # Generate static site

# Testing
npm test            # Run test suite
npm run test:load   # Run load tests

# Utilities
npm run clean       # Clean build artifacts
npm run lint        # Lint code
```

## 🔗 Resources & Links

- **🏠 Website**: [https://jurisjs.com/](https://jurisjs.com/)
- **📦 NPM**: [https://www.npmjs.com/package/juris](https://www.npmjs.com/package/juris)
- **🧰 GitHub Kit**: [https://github.com/jurisjs/juris-kit](https://github.com/jurisjs/juris-kit)
- **💻 GitHub Core**: [https://github.com/jurisjs/juris](https://github.com/jurisjs/juris)
- **🎨 Codepen**: [https://codepen.io/jurisauthor](https://codepen.io/jurisauthor)
- **🧪 Online Testing**: [https://jurisjs.com/tests/juris_pure_test_interface.html](https://jurisjs.com/tests/juris_pure_test_interface.html)

## 🎯 What You Get

### **Immediate Productivity**
- Pre-configured development environment
- Example components and patterns
- Working API integration
- Hot reloading setup

### **Production Ready**
- SSR configuration
- Compression and caching
- Error handling
- Performance optimizations

### **Scalable Architecture**
- Modular component structure
- Headless component patterns
- Clean separation of concerns
- Easy to extend and customize

## 🤝 Contributing

Want to improve Juris Kit? We welcome contributions!

```bash
# Fork and clone
git clone https://github.com/yourusername/juris-kit.git
cd juris-kit
npm install

# Make your changes
# Submit a pull request
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🚀 Next Steps

1. **Explore the Examples** - Check out the included components and pages
2. **Read the Docs** - Visit [jurisjs.com](https://jurisjs.com/) for detailed documentation
3. **Join the Community** - Connect with other Juris developers
4. **Build Something Amazing** - Create your next project with Juris Kit!

---

**Get started in seconds, build for production in minutes.**

*Juris Kit - The fastest way to build reactive web applications.*