// juris.config.js - Central configuration for Juris SSR Application

module.exports = {
	// Server Configuration
	server: {
		port: process.env.PORT || 3000,
		host: process.env.HOST || '0.0.0.0',

		// Fastify server options
		fastify: {
			logger: process.env.NODE_ENV === 'production' ? false : {
				level: 'info',
				prettyPrint: process.env.NODE_ENV !== 'production'
			},
			disableRequestLogging: true,
			keepAliveTimeout: 30000,
			connectionTimeout: 60000,
			bodyLimit: 1048576, // 1MB
			maxParamLength: 100,
			ignoreTrailingSlash: true,
			caseSensitive: false,
			trustProxy: process.env.TRUST_PROXY || false,

			// Performance tuning
			backlog: 1024,
			exclusive: false
		},

		// Compression settings
		compression: {
			enabled: true,
			global: true,
			threshold: 1024, // Only compress responses > 1KB
			encodings: ['gzip', 'deflate'],
			// Optional: compression level (1-9)
			// zlibOptions: { level: 6 }
		}
	},

	// Application Configuration
	app: {
		title: 'Juris SSR App',
		description: 'Server-side rendered application powered by Juris',
		lang: 'en',

		// Meta tags
		meta: {
			charset: 'UTF-8',
			viewport: 'width=device-width, initial-scale=1.0',
			// Add custom meta tags
			custom: [
				// { name: 'author', content: 'Your Name' },
				// { property: 'og:title', content: 'Juris App' }
			]
		},

		// Initial application state
		initialState: {
			counter: 42,
			todos: [
				{ id: 1, text: 'Server-rendered todo1', done: false },
				{ id: 2, text: 'Another todo', done: true }
			],
			user: { name: 'Server User', isLoggedIn: true }
		},

		// Components configuration
		components: {
			// Auto-load components from these directories
			autoLoad: [
				'source/components',
				'source/layouts',
				'source/pages',
				'source/utilities'
			],

			// Headless components configuration
			headless: {
				StringRenderer: {
					autoInit: true,
					options: {}
				},
				Router: {
					autoInit: true,
					options: {
						preserveOnRoute: ['user']
					}
				}
			}
		}
	},

	// Static Files Configuration
	static: {
		// Public directory settings
		public: {
			root: 'public',
			prefix: '/public/',
			cache: {
				maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
				immutable: process.env.NODE_ENV === 'production',
				etag: true,
				lastModified: true
			}
		},

		// Additional static directories
		directories: [
			{
				root: 'assets',
				prefix: '/assets/',
				cache: { maxAge: '7d' }
			},
			{
				root: 'css',
				prefix: '/css/',
				cache: { maxAge: '1d' }
			},
			{
				root: 'js',
				prefix: '/js/',
				cache: { maxAge: '1d' }
			},
			{
				root: 'images',
				prefix: '/images/',
				cache: { maxAge: '30d' }
			}
		]
	},

	// Routing Configuration
	routes: {
		// Enable/disable catch-all route for SSR
		catchAll: true,

		// Custom route handlers (executed before catch-all)
		custom: [
			// {
			//   method: 'GET',
			//   path: '/api/health',
			//   handler: async (request, reply) => {
			//     return { status: 'ok', timestamp: Date.now() }
			//   }
			// }
		],

		// Route-specific configurations
		pages: {
			'/': {
				title: 'Home - Juris App',
				meta: []
			},
			'/about': {
				title: 'About - Juris App',
				meta: []
			},
			'/todos': {
				title: 'Todos - Juris App',
				meta: []
			},
			'/user/:id': {
				title: 'User Profile - Juris App',
				meta: []
			}
		},

		// Files/patterns to exclude from SSR
		exclude: {
			patterns: [
				/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/,
				/^\/\.well-known\//,
				/^\/api\//
			]
		}
	},

	// Build Configuration
	build: {
		// Output directory for built files
		outputDir: 'dist',

		// Stitcher configuration reference
		stitcher: {
			configFile: 'config/stitcher.config.json',
			watch: process.env.NODE_ENV !== 'production'
		},

		// Bundle settings
		bundles: {
			// Main app bundle
			app: {
				input: 'source/app.js',
				output: 'public/js/juris-app.js',
				minify: process.env.NODE_ENV === 'production'
			}
		}
	},

	// Development Configuration
	development: {
		// Hot reload settings
		hotReload: {
			enabled: true,
			paths: ['source', 'juris'],
			extensions: ['.js', '.json']
		},

		// Development-only routes
		routes: [
			{
				method: 'GET',
				path: '/app.js',
				handler: 'serveFile:js/app.js'
			},
			{
				method: 'GET',
				path: '/juris.js',
				handler: 'serveFile:js/juris.js'
			}
		],

		// Error handling
		errorHandling: {
			showStack: true,
			verboseErrors: true
		}
	},

	// Production Configuration
	production: {
		// Security headers
		security: {
			headers: {
				'X-Frame-Options': 'DENY',
				'X-Content-Type-Options': 'nosniff',
				'X-XSS-Protection': '1; mode=block',
				'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
				'Content-Security-Policy': "default-src 'self'"
			}
		},

		// Performance optimizations
		performance: {
			// Enable HTTP/2
			http2: true,

			// Response caching
			cache: {
				// Cache SSR pages for X seconds
				ssrCacheDuration: 0, // Disabled by default

				// Cache static assets
				staticAssets: {
					images: '30d',
					css: '7d',
					js: '7d',
					fonts: '30d'
				}
			}
		},

		// Error handling
		errorHandling: {
			showStack: false,
			verboseErrors: false,
			customErrorPage: true
		}
	},

	// Environment Variables Override
	// Any setting can be overridden using env vars with JURIS_ prefix
	// Example: JURIS_SERVER_PORT=8080
	env: {
		prefix: 'JURIS_',
		// Map specific env vars to config paths
		mapping: {
			'PORT': 'server.port',
			'HOST': 'server.host',
			'NODE_ENV': 'environment',
			'LOG_LEVEL': 'server.fastify.logger.level'
		}
	},

	// Plugins and Extensions
	plugins: [
		// Add custom Fastify plugins or Juris extensions
		// {
		//   name: 'custom-plugin',
		//   register: require('./plugins/custom-plugin'),
		//   options: {}
		// }
	],

	// Hooks for lifecycle events
	hooks: {
		// Called before server starts
		beforeServerStart: async (fastify, config) => {
			// Custom initialization logic
		},

		// Called after server starts
		afterServerStart: async (fastify, config) => {
			// Custom post-start logic
		},

		// Called before each request
		beforeRequest: async (request, reply, config) => {
			// Custom request preprocessing
		},

		// Called before SSR render
		beforeRender: async (app, route, config) => {
			// Modify app state before rendering
		},

		// Called after SSR render
		afterRender: async (html, state, route, config) => {
			// Modify HTML or state after rendering
			return { html, state };
		}
	},

	// Feature Flags
	features: {
		// Enable/disable specific features
		ssr: true,
		compression: true,
		staticServing: true,
		customRoutes: true,
		errorPages: true,
		healthCheck: true,
		metrics: false,

		// Experimental features
		experimental: {
			// streamingSSR: false,
			// edgeRendering: false
		}
	},

	// Monitoring and Logging
	monitoring: {
		// Health check endpoint
		healthCheck: {
			enabled: true,
			path: '/health',
			detailed: process.env.NODE_ENV !== 'production'
		},

		// Metrics collection (if enabled)
		metrics: {
			enabled: false,
			path: '/metrics',
			// collectDefaultMetrics: true
		},

		// Logging configuration
		logging: {
			// Log file settings
			file: {
				enabled: process.env.NODE_ENV === 'production',
				path: 'logs/app.log',
				maxSize: '10m',
				maxFiles: 5
			},

			// Log levels per module
			levels: {
				server: 'info',
				router: 'warn',
				renderer: 'error'
			}
		}
	},

	// Advanced Configuration
	advanced: {
		// Process management
		cluster: {
			enabled: false,
			workers: 'auto' // or specific number
		},

		// Memory limits
		memory: {
			maxHeapSize: '512m',
			monitoring: true
		},

		// Request handling
		requests: {
			timeout: 30000,
			maxConcurrent: 1000
		}
	}
};