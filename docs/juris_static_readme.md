# Juris Static Site Generator

> **Intelligent static site generation with automatic reactivity detection**

Juris Static takes the guesswork out of static site generation by automatically detecting which components can be statically rendered and which require dynamic server-side rendering. Write components once, deploy as static files with zero configuration.

[![Version](https://img.shields.io/badge/version-0.5.2-blue.svg)](https://github.com/jurisjs/juris)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## ✨ Why Juris Static?

### 🎯 **Intelligent Detection**
Automatically identifies which components use reactivity and which are purely static - no manual configuration needed.

### ⚡ **Zero Configuration** 
Just specify your routes and output directory. Juris handles the complexity.

### 🔄 **Hybrid Architecture**
Static files for performance, SSR fallback for dynamic content, on-demand generation for the best of both worlds.

### 📊 **Smart Optimization**
Only generates what needs to be generated, when it needs to be generated.

## 🚀 Quick Start

### Installation

```bash
npm install juris
```

### Basic Static Generation

```javascript
// juris.static.config.js
module.exports = {
  features: { ssr: true, api: false },
  static: {
    generation: {
      enabled: true,
      outputDir: 'dist',
      routes: ['/', '/about', '/contact', '/pricing'],
      copyAssets: true,
      minifyHTML: true
    }
  }
};
```

### Build Static Files

```bash
npx juris-build --config juris.static.config.js
```

### Output Example

```
🚀 Starting static site generation...
📁 Output directory: dist
📂 Copying assets: public → dist/public

📄 Generating: /
🔍 Route /: 📄 static (0 subscriptions)
✅ Generated / (2.3KB) in 45ms

📄 Generating: /about
🔍 Route /about: 📄 static (0 subscriptions)
✅ Generated /about (1.8KB) in 32ms

📄 Generating: /dashboard
🔍 Route /dashboard: ⚡ reactive (5 subscriptions)
⏭️ Skipping /dashboard: uses reactivity

📊 Static Generation Summary:
⏱️  Total time: 123ms
📄 Generated: 3 routes
⏭️  Skipped: 1 routes (reactive)
💾 Total size: 6.1KB
📈 Average: 2.0KB per page
✅ Generated sitemap.xml
✅ Generated build-manifest.json
🎉 Static site generation completed!
```

## 🎯 How It Works

### Automatic Reactivity Detection

Juris analyzes your components during build time to determine if they use reactive state:

```javascript
// ✅ STATIC - Will be generated as HTML file
const AboutPage = () => ({
  div: {
    children: [
      { h1: { text: 'About Us' } },              // Static string
      { p: { text: 'We are a great company' } }, // Static string
      { img: { src: '/team-photo.jpg' } }        // Static attribute
    ]
  }
});

// ❌ REACTIVE - Will use SSR with hydration
const Dashboard = (props, { getState, setState }) => ({
  div: {
    children: [
      { 
        h1: { 
          text: () => `Welcome ${getState('user.name')}` // Function = reactive!
        }
      },
      {
        button: {
          text: 'Refresh Data',
          onclick: () => setState('refreshing', true)   // Event handler = reactive!
        }
      }
    ]
  }
});
```

### The Detection Process

1. **Component Analysis**: Render each component once in isolation
2. **Subscription Tracking**: Monitor which state paths get accessed
3. **Reactivity Check**: `stateManager.subscribers.size > 0` = reactive
4. **Generation Decision**: Static components → HTML files, Reactive components → SSR

### Smart Build Output

```
dist/
├── index.html              ← Static: Homepage
├── about/
│   └── index.html          ← Static: About page
├── contact/
│   └── index.html          ← Static: Contact page
├── pricing/
│   └── index.html          ← Static: Pricing page
├── public/
│   ├── css/
│   ├── js/
│   └── images/
├── sitemap.xml             ← Auto-generated
├── robots.txt              ← Auto-generated
└── build-manifest.json     ← Build statistics
```

## 🔧 Configuration Options

### Complete Configuration

```javascript
// juris.static.config.js
module.exports = {
  features: { 
    ssr: true,      // Enable SSR for dynamic routes
    api: false      // Disable API for static build
  },
  
  static: {
    generation: {
      enabled: true,
      outputDir: 'dist',
      routes: [
        '/',
        '/about',
        '/contact',
        '/pricing',
        '/blog',
        '/blog/post-1',
        '/blog/post-2'
      ],
      
      // Asset handling
      copyAssets: true,
      copyPaths: [
        { from: 'public', to: 'public' },
        { from: 'images', to: 'assets/images' }
      ],
      
      // Optimization
      minifyHTML: true,
      removeComments: true,
      
      // Generation behavior
      parallel: true,
      maxConcurrent: 4,
      cleanOutput: true,
      
      // SEO
      generateSitemap: true,
      generateRobots: true,
      
      // On-demand generation
      onDemand: {
        enabled: true,
        ttl: 5 * 60 * 1000,  // 5 minutes
        maxFileAge: 300000
      }
    }
  },
  
  app: {
    title: 'My Static Site',
    baseUrl: 'https://mysite.com',
    meta: {
      description: 'A blazing fast static site',
      keywords: 'static, fast, juris'
    }
  },
  
  routes: {
    catchAll: false,  // No catch-all for pure static
    pages: {
      '/': { title: 'Home - My Site' },
      '/about': { title: 'About - My Site' },
      '/contact': { title: 'Contact - My Site' }
    }
  },
  
  hooks: {
    beforeGenerate: async (app, route) => {
      console.log(`🔄 Preparing: ${route}`);
    },
    afterGenerate: async (html, state, route) => {
      console.log(`✅ Generated: ${route}`);
      return { html };
    }
  }
};
```

### Environment-Specific Builds

```javascript
// juris.static.dev.config.js - Development builds
module.exports = {
  static: {
    generation: {
      outputDir: 'dev-build',
      minifyHTML: false,
      parallel: false,  // Easier debugging
      cleanOutput: false
    }
  }
};

// juris.static.prod.config.js - Production builds  
module.exports = {
  static: {
    generation: {
      outputDir: 'dist',
      minifyHTML: true,
      parallel: true,
      maxConcurrent: 8,
      generateSitemap: true,
      generateRobots: true
    }
  },
  app: {
    baseUrl: 'https://mysite.com'
  }
};
```

## 🛠️ Build Scripts

### Package.json Setup

```json
{
  "scripts": {
    "build": "juris-static",
    "build:dev": "juris-static --config juris.static.dev.config.js",
    "build:prod": "juris-static --config juris.static.prod.config.js",
    "build:watch": "juris-static --watch",
    "preview": "juris-serve dist",
    "analyze": "juris-static --analyze"
  }
}
```

### Custom Build Script

```javascript
// build.js
const { JurisServer } = require('juris/server');

async function buildStatic() {
  const server = new JurisServer('./juris.static.config.js');
  
  const routes = [
    '/',
    '/about', 
    '/contact',
    '/pricing',
    '/blog'
  ];
  
  const results = await server.generateStaticSites({ 
    routes,
    parallel: true,
    maxConcurrent: 4
  });
  
  console.log(`✅ Generated ${results.generated.length} static files`);
  console.log(`📊 Total size: ${(results.stats.totalSize / 1024).toFixed(1)}KB`);
  
  if (results.errors.length > 0) {
    console.error('❌ Errors occurred during generation');
    process.exit(1);
  }
}

buildStatic().catch(console.error);
```

## 🎯 Advanced Features

### On-Demand Generation

Perfect for sites with many pages - generate static files only when requested:

```javascript
// juris.hybrid.config.js
module.exports = {
  features: { ssr: true, api: true },
  
  static: {
    generation: {
      enabled: true,
      outputDir: 'cache/static',
      routes: ['/', '/about', '/contact'], // Only these routes are eligible
      
      onDemand: {
        enabled: true,
        ttl: 10 * 60 * 1000,  // 10 minutes freshness
        serveStaleWhileRevalidate: true
      }
    }
  },
  
  routes: {
    catchAll: true  // Keep SSR for dynamic routes
  }
};
```

**How it works:**
1. User requests `/about`
2. Check if static file exists and is fresh
3. If yes → serve immediately 
4. If no → check if route can be static
5. If static → generate file and serve
6. If reactive → use normal SSR

### Route Discovery

Automatically discover routes from your file system:

```javascript
// Auto-discover routes from pages directory
const { discoverRoutes } = require('juris/static');

const routes = await discoverRoutes('./source/pages', {
  extensions: ['.js'],
  ignore: ['_layout.js', '_error.js'],
  paramPattern: /\[([^\]]+)\]/g  // [id].js → /:id
});

console.log(routes);
// Output: ['/', '/about', '/blog', '/blog/:slug', '/user/:id']
```

### Incremental Builds

Only rebuild changed routes:

```javascript
// juris.incremental.config.js
module.exports = {
  static: {
    generation: {
      incremental: {
        enabled: true,
        hashStrategy: 'content',  // 'content' | 'mtime' | 'git'
        cacheDir: '.juris-cache',
        force: false
      }
    }
  }
};
```

## 📊 Build Analysis

### Performance Insights

```bash
npx juris-static --analyze
```

```
📊 Build Analysis Report
═══════════════════════════════════════

🏗️  Build Performance:
   Total time: 1.2s
   Routes analyzed: 25
   Static routes: 20 (80%)
   Reactive routes: 5 (20%)
   Average generation: 48ms/route

📄 Generated Files:
   Total files: 20
   Total size: 147KB
   Average size: 7.4KB
   Largest: /blog (15.2KB)
   Smallest: /contact (2.1KB)

⚡ Static Detection:
   Pure static: 15 routes
   Has functions (non-reactive): 5 routes  
   Uses state: 5 routes (skipped)

🎯 Optimization Opportunities:
   ✅ All static routes optimized
   💡 Consider lazy-loading for /blog route
   ⚠️  /dashboard has 12 subscriptions - very reactive

🔍 Bundle Analysis:
   CSS: 23KB (gzipped: 6KB)
   JS: 45KB (gzipped: 12KB)
   Images: 234KB (optimized)
   
📈 Recommendations:
   • Enable image optimization for 15% size reduction
   • Consider code splitting for JS bundle
   • 5 routes could benefit from static generation
```

### Build Manifest

Every build generates a detailed manifest:

```json
{
  "buildTime": "2025-01-14T10:30:15.123Z",
  "generator": "Juris Static Site Generator",
  "version": "0.5.2",
  "config": {
    "outputDir": "dist",
    "minifyHTML": true,
    "parallel": true
  },
  "stats": {
    "totalTime": 1234,
    "totalRoutes": 25,
    "staticRoutes": 20,
    "reactiveRoutes": 5,
    "totalSize": 150528
  },
  "generated": [
    {
      "route": "/",
      "size": 2048,
      "generationTime": 45,
      "subscriptions": 0,
      "isStatic": true
    }
  ],
  "skipped": [
    {
      "route": "/dashboard",
      "reason": "reactivity",
      "subscriptions": 12
    }
  ],
  "assets": {
    "copied": 15,
    "totalSize": 234567
  }
}
```

## 🚀 Deployment

### Static Hosting

Perfect for CDNs and static hosts:

```bash
# Build for production
npm run build:prod

# Deploy to Netlify
netlify deploy --prod --dir=dist

# Deploy to Vercel  
vercel --prod dist

# Deploy to GitHub Pages
gh-pages -d dist

# Deploy to AWS S3
aws s3 sync dist/ s3://my-bucket --delete
```

### Hybrid Deployment

Combine static files with dynamic SSR:

```bash
# Generate static files
npm run build:static

# Start server for dynamic routes
npm start

# Nginx config to serve static first, fallback to SSR
location / {
    try_files $uri $uri/index.html @ssr;
}

location @ssr {
    proxy_pass http://localhost:3000;
}
```

## 🎯 Best Practices

### Component Design for Static Generation

```javascript
// ✅ DO: Separate static and dynamic concerns
const ProductPage = ({ productId }, { getState, api }) => {
  // Static product info can be pre-rendered
  const staticInfo = {
    name: "Product Name",
    description: "Product description",
    price: "$99"
  };
  
  return {
    div: {
      children: [
        // Static content - will be in generated HTML
        { h1: { text: staticInfo.name } },
        { p: { text: staticInfo.description } },
        { span: { text: staticInfo.price } },
        
        // Dynamic content - needs separate component
        { UserSpecificContent: { productId } }
      ]
    }
  };
};

// ❌ DON'T: Mix static and reactive in same component
const BadProductPage = ({ productId }, { getState, api }) => ({
  div: {
    children: [
      { h1: { text: "Product Name" } },           // Static
      { 
        p: { 
          text: () => `Views: ${getState('views')}` // Makes entire component reactive!
        }
      }
    ]
  }
});
```

### Route Organization

```javascript
// Organize routes by static potential
const routes = [
  // Static content routes
  '/',
  '/about',
  '/contact', 
  '/pricing',
  '/privacy',
  '/terms',
  
  // Blog routes (static content)
  '/blog',
  '/blog/getting-started',
  '/blog/advanced-features',
  
  // User-specific routes (will be SSR)
  '/dashboard',
  '/profile',
  '/settings'
];
```

### Performance Optimization

```javascript
// Use async components for data-heavy static pages
const BlogPost = async ({ slug }, { api }) => {
  // This data will be fetched during build time
  const post = await api.posts.getBySlug(slug);
  
  return {
    article: {
      children: [
        { h1: { text: post.title } },
        { div: { innerHTML: post.content } },
        { time: { text: post.publishedAt } }
      ]
    }
  };
};
```

## 🧪 Testing Static Generation

```javascript
// test/static-generation.test.js
const { JurisServer } = require('juris/server');

describe('Static Generation', () => {
  let server;
  
  beforeEach(() => {
    server = new JurisServer('./test/juris.test.config.js');
  });
  
  test('detects static routes correctly', async () => {
    await server.initialize();
    
    const result = await server.shouldGenerateStatic('/about');
    expect(result.canGenerateStatic).toBe(true);
    expect(result.subscriptionCount).toBe(0);
  });
  
  test('detects reactive routes correctly', async () => {
    await server.initialize();
    
    const result = await server.shouldGenerateStatic('/dashboard');
    expect(result.canGenerateStatic).toBe(false);
    expect(result.subscriptionCount).toBeGreaterThan(0);
  });
  
  test('generates static files', async () => {
    const results = await server.generateStaticSites({
      routes: ['/about'],
      outputDir: 'test-output'
    });
    
    expect(results.generated).toHaveLength(1);
    expect(results.generated[0].route).toBe('/about');
    expect(results.errors).toHaveLength(0);
  });
});
```

## 📈 Roadmap

- **v0.6.0** - Incremental builds with smart caching
- **v0.7.0** - Image optimization and asset processing
- **v0.8.0** - Advanced route discovery and dynamic routes
- **v1.0.0** - Full production stability

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>Generate static files intelligently with Juris</strong><br>
  <a href="https://jurisjs.com/static">Documentation</a> • 
  <a href="https://github.com/jurisjs/juris">GitHub</a> • 
  <a href="https://discord.gg/jurisjs">Discord</a>
</p>