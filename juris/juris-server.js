// Location: juris/server.js - Enhanced Juris Server with htmlCache Support
const path = require('path');
const fs = require('fs');
const JurisAPI = require('./juris-api'); // Import JurisAPI class

class JurisServer {
	constructor(configPath = null) {
		this.configPath = configPath || this.findConfigFile();
		this.config = this.loadConfiguration();
		this.fastify = null;
		this.app = null;
		this.api = null;
		this.isInitialized = false;
		this.stringRenderer = null;
		this.router = null;
	}

	// Find configuration file in standard locations
	findConfigFile() {
		const possiblePaths = [
			path.join(process.cwd(), 'config', 'juris.config.js'),
			path.join(process.cwd(), 'config', 'juris.app.js'),
			path.join(process.cwd(), 'config', 'juris.html-cache.config.js'),
			path.join(process.cwd(), 'config', 'juris.model.js'), // Keep for backward compatibility
			path.join(process.cwd(), 'juris.config.js'),
			path.join(process.cwd(), 'juris.html-cache.config.js'), // Add htmlCache config
			path.join(process.cwd(), 'juris.model.js'), // Keep for backward compatibility
			path.join(process.cwd(), '.jurisrc.js')
		];

		for (const configPath of possiblePaths) {
			if (fs.existsSync(configPath)) {
				return configPath;
			}
		}

		console.warn('No juris configuration file found, using default configuration');
		return null;
	}

	// Load and merge configuration
	loadConfiguration() {
		const defaultConfig = this.getDefaultConfig();

		if (!this.configPath) {
			return defaultConfig;
		}

		try {
			if (process.env.NODE_ENV !== 'production') {
				delete require.cache[require.resolve(this.configPath)];
			}

			const userConfig = require(this.configPath);
			return this.deepMerge(defaultConfig, userConfig);
		} catch (error) {
			console.error('Error loading configuration:', error);
			return defaultConfig;
		}
	}

	// Default configuration with htmlCache section
	getDefaultConfig() {
		return {
			server: {
				port: process.env.PORT || 3000,
				host: process.env.HOST || '0.0.0.0',
				fastify: {
					logger: false,
					disableRequestLogging: true,
					keepAliveTimeout: 30000,
					connectionTimeout: 60000,
					bodyLimit: 1048576,
					maxParamLength: 100,
					ignoreTrailingSlash: true,
					caseSensitive: false
				},
				compression: {
					enabled: true,
					global: true,
					threshold: 1024,
					encodings: ['gzip', 'deflate']
				}
			},
			api: {
				prefix: '/api',
				cors: {
					enabled: true,
					origin: true,
					credentials: true
				},
				rateLimit: {
					enabled: false,
					max: 100,
					timeWindow: '1 minute'
				},
				endpoints: {},
				middleware: [],
				interceptors: {
					request: [],
					response: []
				}
			},
			app: {
				title: 'Juris SSR App',
				initialState: {},
				cssPath: '/public/css/styles.css',
				jsPath: '/public/js/juris-app.js'
			},
			static: {
				public: {
					root: 'public',
					prefix: '/public/',
					cache: {
						maxAge: '1d',
						immutable: true,
						etag: true,
						lastModified: true
					}
				},
				directories: []
			},
			// UPDATED: Use htmlCache instead of static.generation
			htmlCache: {
				generation: {
					enabled: true,
					outputDir: 'cache/static',
					routes: ['/about', '/contact'], // Routes eligible for static generation
					ttl: 5 * 60 * 1000, // 5 minutes
					minifyHTML: false,
					onDemand: {
						enabled: true,
						maxFileAge: 300000,
						serveStaleWhileRevalidate: true
					}
				}
			},
			routes: {
				catchAll: true,
				custom: [],
				pages: {},
				exclude: {
					patterns: [
						// Asset files
						/\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|avif)$/,
						/\.(woff|woff2|ttf|eot|otf)$/,
						/\.(mp4|webm|ogg|mp3|wav|flac|aac)$/,
						/\.(pdf|doc|docx|xls|xlsx|zip|rar)$/,
						// System files
						/^\/\.well-known\//,
						/^\/favicon\.ico$/,
						/^\/robots\.txt$/,
						/^\/sitemap\.xml$/,
						// API routes
						/^\/api\//,
						// Public directory
						/^\/public\//
					]
				}
			},
			features: {
				ssr: true,
				api: true,
				compression: true,
				staticServing: true
			},
			hooks: {}
		};
	}

	// Deep merge utility
	deepMerge(target, source) {
		const output = Object.assign({}, target);
		if (isObject(target) && isObject(source)) {
			Object.keys(source).forEach(key => {
				if (isObject(source[key])) {
					if (!(key in target))
						Object.assign(output, { [key]: source[key] });
					else
						output[key] = this.deepMerge(target[key], source[key]);
				} else {
					Object.assign(output, { [key]: source[key] });
				}
			});
		}
		return output;

		function isObject(item) {
			return item && typeof item === 'object' && !Array.isArray(item);
		}
	}

	// Initialize server
	async initialize() {
		if (this.isInitialized) return;

		this.initializeDOMGlobals();

		// Initialize API
		if (this.config.features.api) {
			await this.initializeAPI();
		}

		const fastifyConfig = { ...this.config.server.fastify };

		if (fastifyConfig.logger && typeof fastifyConfig.logger === 'object') {
			delete fastifyConfig.logger.prettyPrint;
			if (process.env.NODE_ENV !== 'production' && fastifyConfig.logger.level) {
				console.log('Note: For pretty logging in development, use pino-pretty separately');
			}
		}

		this.fastify = require('fastify')(fastifyConfig);

		// Setup CORS for API
		if (this.config.features.api && this.config.api.cors.enabled) {
			await this.setupCORS();
		}

		// Setup rate limiting for API
		if (this.config.features.api && this.config.api.rateLimit.enabled) {
			await this.setupRateLimit();
		}

		if (this.config.features.compression && this.config.server.compression.enabled) {
			await this.setupCompression();
		}

		// Setup static file serving FIRST (before API and SSR)
		if (this.config.features.staticServing) {
			await this.setupStaticServing();
		}

		// Debug: List what files are actually available
		if (process.env.NODE_ENV !== 'production') {
			this.debugStaticFiles();
		}

		// Setup custom routes
		if (this.config.routes.custom && this.config.routes.custom.length > 0) {
			await this.setupCustomRoutes();
		}


		if (this.config.monitoring?.healthCheck?.enabled) {
			this.setupHealthCheck();
		}

		if (process.env.NODE_ENV !== 'production' && this.config.development?.routes) {
			await this.setupDevelopmentRoutes();
		}

		// FIXED: Properly await app loading
		await this.loadJurisApp();

		// Register API routes BEFORE SSR catch-all
		if (this.config.features.api && this.api) {
			await this.registerAPIRoutes();
		}
		// Setup SSR catch-all route LAST (so it doesn't capture API routes)
		if (this.config.features.ssr && this.config.routes.catchAll) {
			await this.setupSSRRoute();
		}

		// FIXED: Ensure hooks are properly awaited
		if (this.config.hooks?.beforeServerStart) {
			await Promise.resolve(this.config.hooks.beforeServerStart(this.fastify, this.config));
		}

		this.isInitialized = true;
	}

	// Initialize API system
	async initializeAPI() {
		this.api = new JurisAPI(this.config.api);

		// Add configured middleware
		if (this.config.api.middleware) {
			this.config.api.middleware.forEach(middleware => {
				this.api.addMiddleware(middleware);
			});
		}

		// Add configured interceptors
		if (this.config.api.interceptors.request) {
			this.config.api.interceptors.request.forEach(interceptor => {
				this.api.addRequestInterceptor(interceptor);
			});
		}

		if (this.config.api.interceptors.response) {
			this.config.api.interceptors.response.forEach(interceptor => {
				this.api.addResponseInterceptor(interceptor);
			});
		}

		// Set up endpoints from configuration
		if (this.config.api.endpoints) {
			this.api.setEndpoints(this.config.api.endpoints);
		}
	}

	// Setup CORS
	async setupCORS() {
		try {
			await this.fastify.register(require('@fastify/cors'), this.config.api.cors);
		} catch (error) {
			console.warn('CORS plugin not available. Install with: npm install @fastify/cors');
			console.warn('CORS features will be disabled.');
		}
	}

	// Setup rate limiting
	async setupRateLimit() {
		try {
			await this.fastify.register(require('@fastify/rate-limit'), this.config.api.rateLimit);
		} catch (error) {
			console.warn('Rate limit plugin not available. Install with: npm install @fastify/rate-limit');
			console.warn('Rate limiting features will be disabled.');
		}
	}

	// Register API routes with Fastify
	async registerAPIRoutes() {
		const apiHandler = this.createAPIHandler();

		// Register all HTTP methods for API routes
		this.fastify.get('/api/*', apiHandler);
		this.fastify.post('/api/*', apiHandler);
		this.fastify.put('/api/*', apiHandler);
		this.fastify.patch('/api/*', apiHandler);
		this.fastify.delete('/api/*', apiHandler);
	};

	// Initialize DOM globals for SSR
	initializeDOMGlobals() {
		if (!global.document) {
			global.document = {
				createElement: () => ({}),
				querySelector: () => null,
				querySelectorAll: () => [],
				addEventListener: () => { }
			};
		}

		if (!global.window) {
			global.window = {
				addEventListener: () => { },
				history: null,
				location: { pathname: '/', search: '' }
			};
		}
	}

	// Setup compression
	async setupCompression() {
		try {
			const compressionOptions = {
				...this.config.server.compression,
				enabled: undefined
			};
			await this.fastify.register(require('@fastify/compress'), compressionOptions);
		} catch (error) {
			console.warn('Compression plugin not available. Install with: npm install @fastify/compress');
			console.warn('Compression features will be disabled.');
		}
	}

	// Setup static file serving
	async setupStaticServing() {
		try {
			const fastifyStatic = require('@fastify/static');

			if (this.config.static.public) {
				const publicPath = path.join(process.cwd(), this.config.static.public.root);
				if (fs.existsSync(publicPath)) {
					console.log(`📁 Setting up static serving:`);
					console.log(`   Root: ${publicPath}`);
					console.log(`   Prefix: ${this.config.static.public.prefix}`);

					await this.fastify.register(fastifyStatic, {
						root: publicPath,
						prefix: this.config.static.public.prefix,
						...this.config.static.public.cache
					});

					console.log(`✅ Static files registered successfully`);
				} else {
					console.warn(`⚠️  Static directory not found: ${publicPath}`);
				}
			}

			for (const dir of this.config.static.directories || []) {
				const dirPath = path.join(process.cwd(), dir.root);
				if (fs.existsSync(dirPath)) {
					console.log(`📁 Serving additional static files from: ${dirPath} at ${dir.prefix}`);
					await this.fastify.register(fastifyStatic, {
						root: dirPath,
						prefix: dir.prefix,
						decorateReply: false,
						...(dir.cache || this.config.static.public.cache)
					});
				} else {
					console.warn(`⚠️  Additional static directory not found: ${dirPath}`);
				}
			}
		} catch (error) {
			console.error('❌ Error setting up static file serving:', error.message);
			console.warn('Install with: npm install @fastify/static');
			console.warn('Static file serving will be disabled.');
		}
	}

	// Debug static files
	debugStaticFiles() {
		const publicPath = path.join(process.cwd(), this.config.static.public.root);
		console.log(`\n🔍 Debug: Checking static files in ${publicPath}`);

		if (fs.existsSync(publicPath)) {
			try {
				const files = this.walkDir(publicPath);
				console.log('📂 Available static files:');
				files.forEach(file => {
					const relativePath = path.relative(publicPath, file);
					const urlPath = this.config.static.public.prefix + relativePath.replace(/\\/g, '/');
					console.log(`   ${urlPath}`);
				});
			} catch (error) {
				console.log('   Error reading directory:', error.message);
			}
		} else {
			console.log('   ❌ Public directory does not exist');
			console.log(`   💡 Create it with: mkdir -p ${this.config.static.public.root}`);
		}
	}

	// Walk directory recursively
	walkDir(dir) {
		let files = [];
		const items = fs.readdirSync(dir);

		for (const item of items) {
			const fullPath = path.join(dir, item);
			const stat = fs.statSync(fullPath);

			if (stat.isDirectory()) {
				files = files.concat(this.walkDir(fullPath));
			} else {
				files.push(fullPath);
			}
		}

		return files;
	}

	// Setup custom routes
	async setupCustomRoutes() {
		for (const route of this.config.routes.custom) {
			// FIXED: Ensure route handlers are properly wrapped for async
			const wrappedHandler = async (request, reply) => {
				return await Promise.resolve(route.handler(request, reply));
			};
			this.fastify[route.method.toLowerCase()](route.path, route.options || {}, wrappedHandler);
		}
	}

	// Setup health check endpoint
	setupHealthCheck() {
		const healthConfig = this.config.monitoring.healthCheck;

		this.fastify.get(healthConfig.path || '/health', async (request, reply) => {
			const health = {
				status: 'ok',
				timestamp: Date.now(),
				uptime: process.uptime()
			};

			if (healthConfig.detailed) {
				health.details = {
					memory: process.memoryUsage(),
					pid: process.pid,
					version: process.version,
					config: {
						port: this.config.server.port,
						environment: process.env.NODE_ENV || 'development'
					},
					api: this.api ? {
						endpoints: this.api.getEndpoints().length,
						cached: this.api.responses.size
					} : null
				};
			}

			return health;
		});
	}

	// Setup development routes
	async setupDevelopmentRoutes() {
		for (const route of this.config.development.routes) {
			if (route.handler.startsWith('serveFile:')) {
				const filePath = route.handler.replace('serveFile:', '');
				this.fastify.get(route.path, async (request, reply) => {
					reply.header('Cache-Control', 'no-cache');
					return reply.sendFile(filePath, path.join(process.cwd()));
				});
			} else if (typeof route.handler === 'function') {
				// FIXED: Wrap development route handlers for async
				const wrappedHandler = async (request, reply) => {
					return await Promise.resolve(route.handler(request, reply));
				};
				this.fastify[route.method.toLowerCase()](route.path, wrappedHandler);
			}
		}
	}

	// FIXED: Enhanced app loading with proper async support
	async loadJurisApp() {
		try {
			const appPath = path.join(process.cwd(), 'public/js/juris-app.js');
			let createApp;
			if (fs.existsSync(appPath)) {
				const appModule = require(appPath);
				createApp = appModule.createApp;
				if (appModule.createAPIHandler) {
					this.createAPIHandler = appModule.createAPIHandler;
				} else {
					console.warn('No createAPIHandler found in juris-app.js, using default API handler');
				}
			} else {
				const appModule = require(path.join(process.cwd(), 'source/app.js'));
				createApp = appModule.createApp;
			}

			// FIXED: Properly await app creation
			this.app = await Promise.resolve(createApp(this.config.app.initialState));

			// FIXED: Ensure headless components are fully initialized
			const stringRendererComponent = this.app.getHeadlessComponent('StringRenderer');
			const swapComponent = this.app.getHeadlessComponent('SwapAttributeComponent');
			if (!stringRendererComponent) {
				throw new Error('StringRenderer headless component not found');
			}

			this.stringRenderer = stringRendererComponent.api;
			this.stringRenderer.enableStringRenderer();
			// Ensure SwapAttributeComponent is initialized
			this.app.initializeHeadlessComponent('SwapAttributeComponent', {});
			const routerComponent = this.app.getHeadlessComponent('Router');
			if (!routerComponent) {
				throw new Error('Router headless component not found');
			}

			this.router = routerComponent.api;
			console.log('✅ Juris app loaded successfully');
		} catch (error) {
			console.error('❌ Error loading Juris app:', error);
			throw error;
		}
	}

	//Enhanced SSR route setup with proper async component support
	async setupSSRRoute() {
		const htmlTemplate = this.createHTMLTemplate();

		const routeSchema = {
			response: {
				200: { type: 'string' },
				404: { type: 'string' },
				500: { type: 'string' }
			}
		};

		this.fastify.get('*', { schema: routeSchema }, async (request, reply) => {
			const url = request.url;
			// Check static file patterns first (more comprehensive)
			for (const pattern of this.config.routes.exclude.patterns) {
				if (pattern.test(url)) {
					if (process.env.NODE_ENV !== 'production') {
						console.log(`❌ Static file request rejected from SSR: ${url}`);
					}
					// For static files, return a proper 404
					if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|eot|mp4|pdf)$/.test(url)) {
						reply.code(404);
						reply.header('Content-Type', 'text/plain');
						return `File not found: ${url}`;
					}
					// For other excluded patterns
					reply.code(404);
					return 'Not Found';
				}
			}

			// Auto-detect JSON requests (from fetch, axios, etc.)
			const acceptHeader = request.headers.accept || '';
			if (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
				reply.code(404);
				reply.header('Content-Type', 'application/json');
				return { error: 'Page not found', path: url };
			}

			try {
				// 🎯 INTEGRATION POINT: Check for static generation opportunity
				const staticResult = await this.checkAndGenerateStatic(url, request, reply);
				if (staticResult.served) {
					return staticResult.content;
				}

				// Continue with normal SSR if static generation wasn't used
				this.resetAppForRequest();

				if (this.config.hooks?.beforeRender) {
					await Promise.resolve(this.config.hooks.beforeRender(this.app, url, this.config));
				}

				this.router.setRoute(url);
				let content = this.stringRenderer.renderToString()
				content = content?.then ? await content : content; // Ensure we await if it's a promise

				const state = this.app.stateManager.state;
				state.isHydration = true; // Set hydration flag
				const pageConfig = this.config.routes.pages?.[url] || {};
				const title = pageConfig.title || this.config.app.title;

				let finalHTML = htmlTemplate(content, state, title);

				if (this.config.hooks?.afterRender) {
					const result = await Promise.resolve(this.config.hooks.afterRender(finalHTML, state, url, this.config));
					finalHTML = result.html || finalHTML;
				}

				reply.type('text/html; charset=utf-8');

				if (process.env.NODE_ENV === 'production') {
					if (this.config.production?.performance?.cache?.ssrCacheDuration) {
						reply.header('Cache-Control', `public, max-age=${this.config.production.performance.cache.ssrCacheDuration}`);
					} else {
						reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
					}

					if (this.config.production?.security?.headers) {
						for (const [header, value] of Object.entries(this.config.production.security.headers)) {
							reply.header(header, value);
						}
					}
				} else {
					reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
				}

				return finalHTML;

			} catch (error) {
				console.error('SSR Error:', error);
				reply.code(500);

				// Return JSON error for JSON requests
				if (request.headers.accept && request.headers.accept.includes('application/json')) {
					reply.header('Content-Type', 'application/json');
					return {
						error: 'Internal Server Error',
						message: process.env.NODE_ENV !== 'production' ? error.message : undefined
					};
				}

				// Return HTML error for browser requests
				if (this.config.production?.errorHandling?.customErrorPage && process.env.NODE_ENV === 'production') {
					return await this.renderErrorPage(error);
				}

				const showStack = process.env.NODE_ENV !== 'production' || this.config.development?.errorHandling?.showStack;
				return `<h1>Server Error</h1><p>${error.message}</p>${showStack ? `<pre>${error.stack}</pre>` : ''}`;
			}
		});
	}

	/**
	 * 🎯 UPDATED: Check and generate static files on-demand using htmlCache config
	 */
	async checkAndGenerateStatic(url, request, reply) {
		// UPDATED: Check htmlCache.generation instead of static.generation
		if (!this.config.htmlCache?.generation?.enabled) {
			return { served: false };
		}

		// Check if this route is in the static generation list
		const staticRoutes = this.config.htmlCache.generation.routes || [];
		if (!staticRoutes.includes(url)) {
			return { served: false };
		}

		const outputDir = this.config.htmlCache.generation.outputDir;
		const staticFilePath = this.getStaticFilePath(outputDir, url);

		// 📁 Check if static file already exists and is fresh
		if (await this.isStaticFileFresh(staticFilePath, url)) {
			console.log(`📄 Serving cached static file: ${url}`);
			const staticContent = fs.readFileSync(staticFilePath, 'utf8');

			reply.type('text/html; charset=utf-8');
			reply.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
			reply.header('X-Generated-By', 'Juris-HtmlCache');

			return { served: true, content: staticContent };
		}

		// 🔍 Check if route can be statically generated
		const routeCheck = await this.shouldGenerateStatic(url);

		if (!routeCheck.canGenerateStatic) {
			console.log(`⚡ Route ${url} uses reactivity (${routeCheck.subscriptionCount} subscriptions) - using SSR`);
			return { served: false };
		}

		// 🚀 Generate static file on-demand
		console.log(`📄 Generating static file for: ${url}`);

		try {
			const staticContent = await this.generateStaticFile(url, outputDir);

			reply.type('text/html; charset=utf-8');
			reply.header('Cache-Control', 'public, max-age=3600');
			reply.header('X-Generated-By', 'Juris-HtmlCache-OnDemand');
			reply.header('X-Generation-Time', Date.now().toString());

			console.log(`✅ Generated and served static file: ${url}`);
			return { served: true, content: staticContent };

		} catch (error) {
			console.error(`❌ Failed to generate static file for ${url}:`, error.message);
			return { served: false };
		}
	}

	/**
	 * Get static file path for a route
	 */
	getStaticFilePath(outputDir, route) {
		if (route === '/') {
			return path.join(outputDir, 'index.html');
		}

		const cleanRoute = route.startsWith('/') ? route.slice(1) : route;
		const segments = cleanRoute.split('/').filter(Boolean);
		return path.join(outputDir, ...segments, 'index.html');
	}

	/**
	 * Check if static file exists and is fresh
	 */
	async isStaticFileFresh(filePath, route) {
		if (!fs.existsSync(filePath)) {
			return false;
		}

		// Get file stats
		const stats = fs.statSync(filePath);
		const age = Date.now() - stats.mtime.getTime();

		// UPDATED: Check configured TTL from htmlCache
		const maxAge = this.config.htmlCache?.generation?.ttl || (5 * 60 * 1000); // Default 5 minutes

		const isFresh = age < maxAge;

		if (!isFresh) {
			console.log(`🕒 Static file for ${route} is stale (${Math.round(age / 1000)}s old)`);
		}

		return isFresh;
	}

	/**
	 * Generate a single static file
	 */
	async generateStaticFile(route, outputDir) {
		// Reset app for clean generation
		await this.resetAppForRequest();

		// Execute beforeGenerate hook
		if (this.config.hooks?.beforeGenerate) {
			await Promise.resolve(this.config.hooks.beforeGenerate(this.app, route, this.config));
		}

		// Set route and render
		this.router.setRoute(route);
		const content = await this.stringRenderer.renderToString();
		const state = this.app.stateManager.state;

		// Generate page configuration - UPDATED: Check htmlCache.routes first, then fall back to routes.pages
		const pageConfig = this.config.htmlCache?.routes?.pages?.[route] || this.config.routes?.pages?.[route] || {};
		const title = pageConfig.title || `${this.config.app.title} - ${route}`;

		// Create HTML
		const htmlTemplate = this.createHTMLTemplate();
		let html = htmlTemplate(content, state, title);

		// UPDATED: Minify HTML if enabled in htmlCache config
		if (this.config.htmlCache?.generation?.minifyHTML) {
			html = this.minifyHTML(html);
		}

		// Execute afterGenerate hook
		if (this.config.hooks?.afterGenerate) {
			const result = await Promise.resolve(this.config.hooks.afterGenerate(html, state, route, this.config));
			html = result?.html || html;
		}

		// Ensure output directory exists
		const filePath = this.getStaticFilePath(outputDir, route);
		await this.ensureDirectoryExists(path.dirname(filePath));

		// Write static file
		fs.writeFileSync(filePath, html, 'utf8');

		console.log(`💾 Static file saved: ${filePath} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)}KB)`);

		return html;
	}

	/**
	 * 📊 UPDATED: Add method to get static generation stats using htmlCache config
	 */
	getStaticGenerationStats() {
		if (!this.config.htmlCache?.generation?.enabled) {
			return { enabled: false };
		}

		const outputDir = this.config.htmlCache.generation.outputDir;
		const routes = this.config.htmlCache.generation.routes || [];

		const stats = {
			enabled: true,
			outputDir,
			configuredRoutes: routes.length,
			generatedFiles: 0,
			totalSize: 0,
			files: []
		};

		routes.forEach(route => {
			const filePath = this.getStaticFilePath(outputDir, route);
			if (fs.existsSync(filePath)) {
				const fileStats = fs.statSync(filePath);
				stats.generatedFiles++;
				stats.totalSize += fileStats.size;
				stats.files.push({
					route,
					size: fileStats.size,
					mtime: fileStats.mtime,
					age: Date.now() - fileStats.mtime.getTime()
				});
			}
		});

		return stats;
	}

	// FIXED: Enhanced app reset with proper async support
	async resetAppForRequest() {
		// Reset state manager
		//this.app.stateManager.reset([]);
		this.app.stateManager.state = { ...this.config.app.initialState };

		// If there are any async headless components that need reset, handle them here
		try {
			const headlessComponents = this.app.headlessManager.instances;
			for (const [name, instance] of headlessComponents) {
				if (instance.hooks?.onReset) {
					await Promise.resolve(instance.hooks.onReset());
				}
			}
		} catch (error) {
			console.warn('Warning: Error resetting headless components:', error);
		}
	}

	// Create HTML template function
	createHTMLTemplate() {
		return (content, state, title) => {
			const meta = this.config.app.meta || {};
			const customMeta = meta.custom || [];

			// Check if files exist and adjust paths
			const cssPath = this.config.app.cssPath || '/public/css/styles.css';
			const jsPath = this.config.app.jsPath || '/public/js/juris-app.js';
			const jsScript = this.app.stateManager.state._juris?.swapScripts || null
			let html = `<!DOCTYPE html>
<html lang="${this.config.app.lang || 'en'}">
<head>
    <meta charset="${meta.charset || 'UTF-8'}">
    <meta name="viewport" content="${meta.viewport || 'width=device-width, initial-scale=1.0'}">
    <title>${title}</title>
    ${customMeta.map(m => {
				if (m.name) return `<meta name="${m.name}" content="${m.content}">`;
				if (m.property) return `<meta property="${m.property}" content="${m.content}">`;
				return '';
			}).join('\n    ')}
    <link rel="stylesheet" href="${cssPath}">
</head>
<body>
    <div id="app">${content}</div>`;
			if (!jsScript) {
				html += `
			<script>
					window.__hydration_data = ${JSON.stringify(state)};
			</script>`;
			}

			if (jsScript) {
				html += `<script>${jsScript}</script>`;
			} else {
				html += `
    <script src="${jsPath}"></script>`;
			}

			html += `
</body>
</html>`;
			return html;
		};
	}

	// FIXED: Enhanced error page rendering with async support
	async renderErrorPage(error) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error - ${this.config.app.title}</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        h1 { color: #d32f2f; }
        .error-code { background: #f5f5f5; padding: 10px; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>Something went wrong</h1>
    <p>We're sorry, but something went wrong on our end.</p>
    <p class="error-code">Error Code: ${Date.now()}</p>
</body>
</html>`;
	}

	// Start server
	async start() {
		try {
			await this.initialize();

			const listenOptions = {
				port: this.config.server.port,
				host: this.config.server.host,
				backlog: this.config.server.fastify.backlog || 1024,
				exclusive: this.config.server.fastify.exclusive || false
			};

			await this.fastify.listen(listenOptions);

			// FIXED: Properly await afterServerStart hook
			if (this.config.hooks?.afterServerStart) {
				await Promise.resolve(this.config.hooks.afterServerStart(this.fastify, this.config));
			}

			console.log(`🚀 Juris Server running on http://${this.config.server.host}:${this.config.server.port}`);
			console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
			console.log(`Configuration: ${this.configPath || 'default'}`);

			// UPDATED: Show htmlCache status in startup info
			if (this.config.htmlCache?.generation?.enabled) {
				console.log(`📄 HTML Cache enabled: ${this.config.htmlCache.generation.routes.length} routes configured`);
			}

			if (process.env.NODE_ENV !== 'production') {
				console.log('\nEnabled features:');
				Object.entries(this.config.features).forEach(([feature, enabled]) => {
					if (enabled) console.log(`  ✓ ${feature}`);
				});

				console.log('\nAvailable routes:');

				// Show API routes
				if (this.config.features.api && this.api) {
					const endpoints = this.api.getEndpoints();
					if (endpoints.length > 0) {
						console.log('\n  API Endpoints:');
						endpoints.forEach(endpoint => {
							const status = endpoint.hasHandler ? '✓' : (endpoint.hasMock ? '🎭' : '⚠️');
							console.log(`    ${status} ${endpoint.method} ${this.config.api.prefix}${endpoint.url}`);
						});
					}
				}

				// Show custom routes
				this.config.routes.custom?.forEach(route => {
					console.log(`  ${route.method} ${route.path}`);
				});

				if (this.config.monitoring?.healthCheck?.enabled) {
					console.log(`  GET ${this.config.monitoring.healthCheck.path || '/health'} - Health check`);
				}
				if (this.config.routes.catchAll) {
					console.log('  GET * - SSR catch-all');
				}

				// Show htmlCache routes
				if (this.config.htmlCache?.generation?.enabled) {
					console.log('\n  HTML Cache Routes:');
					this.config.htmlCache.generation.routes.forEach(route => {
						console.log(`    📄 ${route} - cacheable`);
					});
				}
			}

		} catch (err) {
			console.error('Failed to start server:', err);
			process.exit(1);
		}
	}

	// Stop server
	async stop() {
		if (this.fastify) {
			await this.fastify.close();
		}
	}

	// Reload configuration (for development)
	async reload() {
		console.log('Reloading configuration...');
		this.config = this.loadConfiguration();
		await this.stop();
		this.isInitialized = false;
		await this.start();
	}

	/**
	 * UPDATED: Generate static sites based on htmlCache configuration
	 */
	async generateStaticSites(options = {}) {
		// UPDATED: Check htmlCache.generation instead of static.generation
		if (!this.config.htmlCache?.generation?.enabled) {
			console.log('📄 HTML Cache generation is disabled in configuration');
			return { generated: [], skipped: [], errors: [] };
		}

		console.log('🚀 Starting HTML cache generation...');
		console.log(`📁 Output directory: ${this.config.htmlCache.generation.outputDir}`);

		// UPDATED: Merge options with htmlCache config
		const generationConfig = {
			...this.config.htmlCache.generation,
			...options
		};

		const {
			outputDir,
			routes = [],
			copyAssets = true,
			minifyHTML = false,
			cleanOutput = true,
			parallel = false,
			maxConcurrent = 3
		} = generationConfig;

		// Ensure we're initialized
		if (!this.isInitialized) {
			await this.initialize();
		}

		const results = {
			generated: [],
			skipped: [],
			errors: [],
			stats: {
				startTime: Date.now(),
				totalRoutes: routes.length,
				totalSize: 0,
				reactiveRoutes: 0,
				staticRoutes: 0
			}
		};

		try {
			// Prepare output directory
			await this.prepareOutputDirectory(outputDir, cleanOutput);

			// Copy assets first if enabled
			if (copyAssets) {
				await this.copyAssets(outputDir);
			}

			// Generate routes
			if (parallel && routes.length > maxConcurrent) {
				await this.generateRoutesParallel(routes, outputDir, generationConfig, results);
			} else {
				await this.generateRoutesSequential(routes, outputDir, generationConfig, results);
			}

			// Finalize generation
			await this.finalizeGeneration(outputDir, generationConfig, results);

			// Print summary
			this.printGenerationSummary(results);

			return results;

		} catch (error) {
			console.error('❌ HTML cache generation failed:', error);
			results.errors.push({ route: 'SYSTEM', error: error.message });
			throw error;
		}
	}

	/**
	 * Check if route should be statically generated
	 */
	async shouldGenerateStatic(route) {
		try {
			// Reset app for clean state
			await this.resetAppForRequest();

			// Set the route
			this.router.setRoute(route);

			// Render once to detect reactivity
			await this.stringRenderer.renderToString();

			// Check if any reactive subscriptions were created
			const hasReactivity = this.app.stateManager.subscribers.size > 0;

			console.log(`🔍 Route ${route}: ${hasReactivity ? '⚡ reactive' : '📄 static'}`);

			return {
				canGenerateStatic: !hasReactivity,
				hasReactivity,
				subscriptionCount: this.app.stateManager.subscribers.size
			};

		} catch (error) {
			console.warn(`⚠️  Error checking reactivity for ${route}:`, error.message);
			return { canGenerateStatic: false, hasReactivity: true, error: error.message };
		}
	}

	/**
	 * Generate routes sequentially
	 */
	async generateRoutesSequential(routes, outputDir, config, results) {
		for (const route of routes) {
			try {
				await this.generateSingleRoute(route, outputDir, config, results);
			} catch (error) {
				console.error(`❌ Failed to generate ${route}:`, error.message);
				results.errors.push({ route, error: error.message });
			}
		}
	}

	/**
	 * Generate routes in parallel batches
	 */
	async generateRoutesParallel(routes, outputDir, config, results) {
		const { maxConcurrent = 3 } = config;

		console.log(`🔄 Generating ${routes.length} routes in parallel (max ${maxConcurrent} concurrent)`);

		for (let i = 0; i < routes.length; i += maxConcurrent) {
			const batch = routes.slice(i, i + maxConcurrent);

			const promises = batch.map(async (route) => {
				try {
					await this.generateSingleRoute(route, outputDir, config, results);
				} catch (error) {
					console.error(`❌ Failed to generate ${route}:`, error.message);
					results.errors.push({ route, error: error.message });
				}
			});

			await Promise.all(promises);
			console.log(`✅ Completed batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(routes.length / maxConcurrent)}`);
		}
	}

	/**
	 * Generate a single route
	 */
	async generateSingleRoute(route, outputDir, config, results) {
		const startTime = Date.now();

		console.log(`📄 Generating: ${route}`);

		// Check if route should be generated statically
		const routeCheck = await this.shouldGenerateStatic(route);

		if (!routeCheck.canGenerateStatic) {
			console.log(`⏭️  Skipping ${route}: ${routeCheck.hasReactivity ? 'uses reactivity' : 'error detected'}`);
			results.skipped.push({
				route,
				reason: routeCheck.hasReactivity ? 'reactivity' : 'error',
				subscriptions: routeCheck.subscriptionCount,
				error: routeCheck.error
			});
			return;
		}

		// Reset app for clean generation
		await this.resetAppForRequest();

		// Execute any beforeGenerate hooks
		if (this.config.hooks?.beforeGenerate) {
			await Promise.resolve(this.config.hooks.beforeGenerate(this.app, route, this.config));
		}

		// Set route and render
		this.router.setRoute(route);
		const content = await this.stringRenderer.renderToString();
		const state = this.app.stateManager.state;

		// UPDATED: Generate page configuration from htmlCache or routes
		const pageConfig = this.config.htmlCache?.routes?.pages?.[route] || this.config.routes?.pages?.[route] || {};
		const title = pageConfig.title || `${this.config.app.title} - ${route}`;

		// Create HTML
		const htmlTemplate = this.createHTMLTemplate();
		let html = htmlTemplate(content, state, title);

		// Minify HTML if enabled
		if (config.minifyHTML) {
			html = this.minifyHTML(html);
		}

		// Execute any afterGenerate hooks
		if (this.config.hooks?.afterGenerate) {
			const result = await Promise.resolve(this.config.hooks.afterGenerate(html, state, route, this.config));
			html = result?.html || html;
		}

		// Write file
		const filePath = this.getOutputPath(outputDir, route);
		await this.ensureDirectoryExists(path.dirname(filePath));
		fs.writeFileSync(filePath, html, 'utf8');

		const endTime = Date.now();
		const fileSize = Buffer.byteLength(html, 'utf8');

		// Record success
		results.generated.push({
			route,
			filePath,
			size: fileSize,
			generationTime: endTime - startTime,
			isStatic: true,
			subscriptions: 0
		});

		results.stats.totalSize += fileSize;
		results.stats.staticRoutes++;

		console.log(`✅ Generated ${route} (${(fileSize / 1024).toFixed(1)}KB) in ${endTime - startTime}ms`);
	}

	/**
	 * Prepare output directory
	 */
	async prepareOutputDirectory(outputDir, cleanOutput) {
		const fullOutputPath = path.resolve(outputDir);

		if (cleanOutput && fs.existsSync(fullOutputPath)) {
			console.log(`🧹 Cleaning output directory: ${fullOutputPath}`);
			fs.rmSync(fullOutputPath, { recursive: true, force: true });
		}

		fs.mkdirSync(fullOutputPath, { recursive: true });
		console.log(`📁 Output directory ready: ${fullOutputPath}`);
	}

	/**
	 * Copy assets to output directory
	 */
	async copyAssets(outputDir) {
		const publicDir = path.join(process.cwd(), this.config.static?.public?.root || 'public');

		if (!fs.existsSync(publicDir)) {
			console.log(`⚠️  Public directory not found: ${publicDir}`);
			return;
		}

		const outputPublicDir = path.join(outputDir, 'public');

		console.log(`📂 Copying assets: ${publicDir} → ${outputPublicDir}`);

		await this.copyDirectory(publicDir, outputPublicDir);

		console.log(`✅ Assets copied successfully`);
	}

	/**
	 * Copy directory recursively
	 */
	async copyDirectory(src, dest) {
		fs.mkdirSync(dest, { recursive: true });

		const entries = fs.readdirSync(src, { withFileTypes: true });

		for (const entry of entries) {
			const srcPath = path.join(src, entry.name);
			const destPath = path.join(dest, entry.name);

			if (entry.isDirectory()) {
				await this.copyDirectory(srcPath, destPath);
			} else {
				fs.copyFileSync(srcPath, destPath);
			}
		}
	}

	/**
	 * Get output file path for route
	 */
	getOutputPath(outputDir, route) {
		if (route === '/') {
			return path.join(outputDir, 'index.html');
		}

		// Handle routes like /about, /todos, /user/123
		const cleanRoute = route.startsWith('/') ? route.slice(1) : route;
		const segments = cleanRoute.split('/').filter(Boolean);

		// Create nested directory structure
		const dirPath = path.join(outputDir, ...segments);
		return path.join(dirPath, 'index.html');
	}

	/**
	 * Ensure directory exists
	 */
	async ensureDirectoryExists(dirPath) {
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}
	}

	/**
	 * Minify HTML (basic implementation)
	 */
	minifyHTML(html) {
		return html
			.replace(/\s+/g, ' ')                    // Multiple spaces to single
			.replace(/>\s+</g, '><')                 // Remove spaces between tags
			.replace(/<!--[\s\S]*?-->/g, '')         // Remove comments
			.trim();
	}

	/**
	 * Finalize generation process
	 */
	async finalizeGeneration(outputDir, config, results) {
		// Generate sitemap if enabled
		if (config.generateSitemap) {
			await this.generateSitemap(outputDir, results.generated);
		}

		// Generate robots.txt if enabled
		if (config.generateRobots) {
			await this.generateRobotsTxt(outputDir);
		}

		// Generate build manifest
		await this.generateBuildManifest(outputDir, results);

		results.stats.endTime = Date.now();
		results.stats.totalTime = results.stats.endTime - results.stats.startTime;
	}

	/**
	 * Generate sitemap.xml
	 */
	async generateSitemap(outputDir, generatedRoutes) {
		const baseUrl = this.config.app.baseUrl || 'http://localhost:3000';
		const currentDate = new Date().toISOString();

		const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${generatedRoutes.map(({ route }) => `  <url>
    <loc>${baseUrl}${route}</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${route === '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>`;

		fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap);
		console.log('✅ Generated sitemap.xml');
	}

	/**
	 * Generate robots.txt
	 */
	async generateRobotsTxt(outputDir) {
		const baseUrl = this.config.app.baseUrl || 'http://localhost:3000';

		const robots = `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml`;

		fs.writeFileSync(path.join(outputDir, 'robots.txt'), robots);
		console.log('✅ Generated robots.txt');
	}

	/**
	 * Generate build manifest
	 */
	async generateBuildManifest(outputDir, results) {
		const manifest = {
			buildTime: new Date().toISOString(),
			generator: 'Juris HTML Cache Generator',
			version: '1.0.0',
			config: {
				outputDir: this.config.htmlCache.generation.outputDir,
				minifyHTML: this.config.htmlCache.generation.minifyHTML,
				copyAssets: this.config.htmlCache.generation.copyAssets || true
			},
			stats: results.stats,
			generated: results.generated.map(r => ({
				route: r.route,
				size: r.size,
				generationTime: r.generationTime
			})),
			skipped: results.skipped,
			errors: results.errors
		};

		fs.writeFileSync(
			path.join(outputDir, 'build-manifest.json'),
			JSON.stringify(manifest, null, 2)
		);
		console.log('✅ Generated build-manifest.json');
	}

	/**
	 * Print generation summary
	 */
	printGenerationSummary(results) {
		const { stats, generated, skipped, errors } = results;

		console.log('\n📊 HTML Cache Generation Summary:');
		console.log('═'.repeat(50));
		console.log(`⏱️  Total time: ${stats.totalTime}ms`);
		console.log(`📄 Generated: ${generated.length} routes`);
		console.log(`⏭️  Skipped: ${skipped.length} routes`);
		console.log(`❌ Errors: ${errors.length} routes`);
		console.log(`💾 Total size: ${(stats.totalSize / 1024).toFixed(1)}KB`);
		console.log(`📈 Average size: ${generated.length > 0 ? (stats.totalSize / generated.length / 1024).toFixed(1) : 0}KB per page`);

		if (generated.length > 0) {
			console.log('\n✅ Generated Pages:');
			generated.forEach(({ route, size, generationTime }) => {
				console.log(`  ${route} - ${(size / 1024).toFixed(1)}KB (${generationTime}ms)`);
			});
		}

		if (skipped.length > 0) {
			console.log('\n⏭️ Skipped Pages:');
			skipped.forEach(({ route, reason, subscriptions }) => {
				console.log(`  ${route} - ${reason} ${subscriptions ? `(${subscriptions} subscriptions)` : ''}`);
			});
		}

		if (errors.length > 0) {
			console.log('\n❌ Errors:');
			errors.forEach(({ route, error }) => {
				console.log(`  ${route} - ${error}`);
			});
		}

		console.log('═'.repeat(50));
	}

	/**
	 * UPDATED: CLI method for static generation using htmlCache
	 */
	static async generateStatic(configPath = null) {
		const server = new JurisServer(configPath);

		try {
			await server.initialize();
			const results = await server.generateStaticSites();

			if (results.errors.length > 0) {
				process.exit(1);
			}

			console.log('🎉 HTML cache generation completed successfully!');
			return results;

		} catch (error) {
			console.error('💥 HTML cache generation failed:', error);
			process.exit(1);
		}
	}
}

// Export the server class
module.exports = JurisServer;