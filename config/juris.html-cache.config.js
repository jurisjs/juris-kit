module.exports = {
	// HTML Cache configuration (replaces static.generation)
	htmlCache: {
		generation: {
			enabled: true,
			outputDir: 'cache/static',           // Where to cache static files
			routes: ['/', '/about', '/contact'], // Routes eligible for static generation
			ttl: 5 * 60 * 1000,                 // 5 minutes - how long static files are fresh
			minifyHTML: true,
			copyAssets: true,                    // Copy public assets to output
			cleanOutput: true,                   // Clean output dir before generation
			parallel: false,                     // Generate routes in parallel
			maxConcurrent: 3,                    // Max concurrent generations
			generateSitemap: true,               // Generate sitemap.xml
			generateRobots: true,                // Generate robots.txt
			onDemand: {
				enabled: true,                   // Enable on-demand generation
				maxFileAge: 300000,             // 5 minutes in milliseconds
				serveStaleWhileRevalidate: true // Serve stale file while generating new one
			}
		},
		// Page-specific configuration for htmlCache routes
		routes: {
			pages: {
				'/': { title: 'Home Page' },
				'/about': { title: 'About Us' },
				'/contact': { title: 'Contact Us' }
			}
		}
	},
	hooks: {
		beforeGenerate: async (app, route, config) => {
			console.log(`🔄 Preparing to generate: ${route}`);
		},
		afterGenerate: async (html, state, route, config) => {
			console.log(`✅ Generated static file for: ${route}`);
			return { html };
		}
	}
};
