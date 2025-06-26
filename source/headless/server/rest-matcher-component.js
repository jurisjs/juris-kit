// RestMatcher - Advanced Headless Component for REST Endpoint Pattern Matching
const RestMatcherComponent = (props, context) => {
	const { getState, setState, juris } = context;

	// Advanced route parser with multiple parameter types
	class RouteParser {
		constructor() {
			this.paramTypes = {
				// Standard parameter: :id
				standard: {
					pattern: /:([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
					replacer: '([^/]+)',
					extractor: (value) => value
				},
				// Numeric parameter: :id(int)
				int: {
					pattern: /:([a-zA-Z_$][a-zA-Z0-9_$]*)\(int\)/g,
					replacer: '(\\d+)',
					extractor: (value) => parseInt(value, 10)
				},
				// Float parameter: :price(float)
				float: {
					pattern: /:([a-zA-Z_$][a-zA-Z0-9_$]*)\(float\)/g,
					replacer: '([0-9]*\\.?[0-9]+)',
					extractor: (value) => parseFloat(value)
				},
				// UUID parameter: :id(uuid)
				uuid: {
					pattern: /:([a-zA-Z_$][a-zA-Z0-9_$]*)\(uuid\)/g,
					replacer: '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
					extractor: (value) => value
				},
				// Enum parameter: :status(enum:active,inactive,pending)
				enum: {
					pattern: /:([a-zA-Z_$][a-zA-Z0-9_$]*)\(enum:([^)]+)\)/g,
					replacer: (match, name, values) => `(${values.split(',').join('|')})`,
					extractor: (value) => value
				},
				// Wildcard parameter: *path
				wildcard: {
					pattern: /\*([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
					replacer: '(.*)',
					extractor: (value) => value
				},
				// Optional parameter: :id?
				optional: {
					pattern: /:([a-zA-Z_$][a-zA-Z0-9_$]*)\?/g,
					replacer: '([^/]*)',
					extractor: (value) => value || undefined
				}
			};
		}

		parse(pattern) {
			let regex = pattern;
			const params = [];
			const paramTypes = {};

			// Process each parameter type in order of specificity
			Object.entries(this.paramTypes).forEach(([type, config]) => {
				regex = regex.replace(config.pattern, (match, name, extra) => {
					params.push(name);
					paramTypes[name] = { type, extractor: config.extractor, extra };

					if (typeof config.replacer === 'function') {
						return config.replacer(match, name, extra);
					}
					return config.replacer;
				});
			});

			// Escape special regex characters except our parameter placeholders
			regex = regex.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

			// Make the entire pattern case-insensitive if configured
			const regexObj = new RegExp(`^${regex}$`, 'i');

			return {
				regex: regexObj,
				params,
				paramTypes,
				originalPattern: pattern
			};
		}

		extractParams(parsedRoute, path) {
			const match = path.match(parsedRoute.regex);
			if (!match) return null;

			const params = {};
			parsedRoute.params.forEach((paramName, index) => {
				const value = match[index + 1];
				const paramConfig = parsedRoute.paramTypes[paramName];

				if (value !== undefined) {
					try {
						params[paramName] = paramConfig.extractor(value);
					} catch (error) {
						// If extraction fails, use raw value
						params[paramName] = value;
					}
				}
			});

			return params;
		}
	}

	// Advanced endpoint registry with grouping and middleware support
	class EndpointRegistry {
		constructor() {
			this.endpoints = new Map();
			this.groups = new Map();
			this.middleware = [];
			this.parser = new RouteParser();
			this.cache = new Map();
		}

		addEndpoint(method, pattern, config = {}) {
			const id = `${method}:${pattern}`;
			const parsedRoute = this.parser.parse(pattern);

			const endpoint = {
				id,
				method: method.toUpperCase(),
				pattern,
				parsedRoute,
				config: {
					handler: config.handler || null,
					middleware: config.middleware || [],
					auth: config.auth || null,
					rateLimit: config.rateLimit || null,
					cache: config.cache || null,
					validation: config.validation || null,
					description: config.description || '',
					tags: config.tags || [],
					version: config.version || '1.0',
					deprecated: config.deprecated || false,
					priority: config.priority || 0,
					group: config.group || null,
					meta: config.meta || {}
				},
				createdAt: new Date(),
				stats: {
					matchCount: 0,
					lastMatched: null
				}
			};

			this.endpoints.set(id, endpoint);

			// Add to group if specified
			if (config.group) {
				this.addToGroup(config.group, endpoint);
			}

			// Clear cache when endpoints change
			this.cache.clear();

			return endpoint;
		}

		addGroup(name, config = {}) {
			this.groups.set(name, {
				name,
				prefix: config.prefix || '',
				middleware: config.middleware || [],
				auth: config.auth || null,
				description: config.description || '',
				version: config.version || '1.0',
				endpoints: []
			});
		}

		addToGroup(groupName, endpoint) {
			if (!this.groups.has(groupName)) {
				this.addGroup(groupName);
			}
			this.groups.get(groupName).endpoints.push(endpoint.id);
		}

		addGlobalMiddleware(middleware) {
			this.middleware.push(middleware);
		}

		removeEndpoint(method, pattern) {
			const id = `${method}:${pattern}`;
			const endpoint = this.endpoints.get(id);

			if (endpoint && endpoint.config.group) {
				const group = this.groups.get(endpoint.config.group);
				if (group) {
					group.endpoints = group.endpoints.filter(e => e !== id);
				}
			}

			this.endpoints.delete(id);
			this.cache.clear();
			return endpoint;
		}

		getEndpoints(filters = {}) {
			let endpoints = Array.from(this.endpoints.values());

			if (filters.method) {
				endpoints = endpoints.filter(e => e.method === filters.method.toUpperCase());
			}

			if (filters.group) {
				endpoints = endpoints.filter(e => e.config.group === filters.group);
			}

			if (filters.tags && filters.tags.length > 0) {
				endpoints = endpoints.filter(e =>
					filters.tags.some(tag => e.config.tags.includes(tag))
				);
			}

			if (filters.deprecated !== undefined) {
				endpoints = endpoints.filter(e => e.config.deprecated === filters.deprecated);
			}

			if (filters.version) {
				endpoints = endpoints.filter(e => e.config.version === filters.version);
			}

			// Sort by priority (higher first), then by creation date
			return endpoints.sort((a, b) => {
				if (a.config.priority !== b.config.priority) {
					return b.config.priority - a.config.priority;
				}
				return a.createdAt - b.createdAt;
			});
		}

		match(method, path, options = {}) {
			const cacheKey = `${method}:${path}`;

			// Check cache first
			if (options.useCache !== false && this.cache.has(cacheKey)) {
				const cached = this.cache.get(cacheKey);
				if (cached.endpoint) {
					cached.endpoint.stats.matchCount++;
					cached.endpoint.stats.lastMatched = new Date();
				}
				return cached;
			}

			const candidates = this.getEndpoints({ method });

			for (const endpoint of candidates) {
				const params = this.parser.extractParams(endpoint.parsedRoute, path);

				if (params !== null) {
					// Update stats
					endpoint.stats.matchCount++;
					endpoint.stats.lastMatched = new Date();

					const result = {
						matched: true,
						endpoint,
						params,
						query: this.parseQuery(options.queryString || ''),
						path,
						method: method.toUpperCase(),
						matchedAt: new Date()
					};

					// Cache the result
					if (options.useCache !== false) {
						this.cache.set(cacheKey, result);
					}

					return result;
				}
			}

			const result = {
				matched: false,
				endpoint: null,
				params: {},
				query: this.parseQuery(options.queryString || ''),
				path,
				method: method.toUpperCase(),
				suggestions: this.getSuggestions(method, path),
				matchedAt: new Date()
			};

			// Cache negative results too
			if (options.useCache !== false) {
				this.cache.set(cacheKey, result);
			}

			return result;
		}

		parseQuery(queryString) {
			const query = {};
			if (!queryString) return query;

			queryString.split('&').forEach(pair => {
				const [key, value] = pair.split('=');
				if (key) {
					const decodedKey = decodeURIComponent(key);
					const decodedValue = value ? decodeURIComponent(value) : '';

					// Handle array parameters (key[]=value)
					if (decodedKey.endsWith('[]')) {
						const arrayKey = decodedKey.slice(0, -2);
						if (!query[arrayKey]) query[arrayKey] = [];
						query[arrayKey].push(decodedValue);
					} else {
						query[decodedKey] = decodedValue;
					}
				}
			});

			return query;
		}

		getSuggestions(method, path) {
			const suggestions = [];
			const candidates = this.getEndpoints();

			// Find similar paths using Levenshtein distance
			candidates.forEach(endpoint => {
				const distance = this.levenshteinDistance(path, endpoint.pattern);
				const similarity = 1 - (distance / Math.max(path.length, endpoint.pattern.length));

				if (similarity > 0.6) { // 60% similarity threshold
					suggestions.push({
						endpoint: endpoint.pattern,
						method: endpoint.method,
						similarity: Math.round(similarity * 100),
						reason: this.getSuggestionReason(method, path, endpoint)
					});
				}
			});

			return suggestions.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
		}

		getSuggestionReason(method, path, endpoint) {
			if (method !== endpoint.method) {
				return `Method mismatch: try ${endpoint.method} instead of ${method}`;
			}

			const pathSegments = path.split('/').filter(Boolean);
			const patternSegments = endpoint.pattern.split('/').filter(Boolean);

			if (pathSegments.length !== patternSegments.length) {
				return `Segment count mismatch: expected ${patternSegments.length}, got ${pathSegments.length}`;
			}

			return 'Similar pattern found';
		}

		levenshteinDistance(str1, str2) {
			const matrix = [];

			for (let i = 0; i <= str2.length; i++) {
				matrix[i] = [i];
			}

			for (let j = 0; j <= str1.length; j++) {
				matrix[0][j] = j;
			}

			for (let i = 1; i <= str2.length; i++) {
				for (let j = 1; j <= str1.length; j++) {
					if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
						matrix[i][j] = matrix[i - 1][j - 1];
					} else {
						matrix[i][j] = Math.min(
							matrix[i - 1][j - 1] + 1,
							matrix[i][j - 1] + 1,
							matrix[i - 1][j] + 1
						);
					}
				}
			}

			return matrix[str2.length][str1.length];
		}

		getStats() {
			const endpoints = Array.from(this.endpoints.values());
			const groups = Array.from(this.groups.values());

			return {
				totalEndpoints: endpoints.length,
				totalGroups: groups.length,
				methodBreakdown: this.getMethodBreakdown(endpoints),
				mostMatched: endpoints
					.filter(e => e.stats.matchCount > 0)
					.sort((a, b) => b.stats.matchCount - a.stats.matchCount)
					.slice(0, 10),
				cacheSize: this.cache.size,
				deprecatedCount: endpoints.filter(e => e.config.deprecated).length,
				groupBreakdown: groups.map(g => ({
					name: g.name,
					endpointCount: g.endpoints.length
				}))
			};
		}

		getMethodBreakdown(endpoints) {
			const breakdown = {};
			endpoints.forEach(e => {
				breakdown[e.method] = (breakdown[e.method] || 0) + 1;
			});
			return breakdown;
		}

		clearCache() {
			this.cache.clear();
		}

		exportSchema() {
			const endpoints = Array.from(this.endpoints.values());
			const groups = Array.from(this.groups.values());

			return {
				version: '1.0',
				generatedAt: new Date().toISOString(),
				endpoints: endpoints.map(e => ({
					method: e.method,
					pattern: e.pattern,
					config: e.config,
					stats: e.stats
				})),
				groups: groups,
				globalMiddleware: this.middleware
			};
		}

		importSchema(schema) {
			this.endpoints.clear();
			this.groups.clear();
			this.middleware = [];
			this.cache.clear();

			// Import groups first
			if (schema.groups) {
				schema.groups.forEach(group => {
					this.groups.set(group.name, { ...group, endpoints: [] });
				});
			}

			// Import endpoints
			if (schema.endpoints) {
				schema.endpoints.forEach(e => {
					this.addEndpoint(e.method, e.pattern, e.config);
				});
			}

			// Import global middleware
			if (schema.globalMiddleware) {
				this.middleware = [...schema.globalMiddleware];
			}
		}
	}

	// Create registry instance
	const registry = new EndpointRegistry();

	// Initialize with default configuration from props
	if (props.endpoints) {
		props.endpoints.forEach(endpoint => {
			registry.addEndpoint(
				endpoint.method,
				endpoint.pattern,
				endpoint.config || {}
			);
		});
	}

	if (props.groups) {
		props.groups.forEach(group => {
			registry.addGroup(group.name, group.config || {});
		});
	}

	if (props.middleware) {
		props.middleware.forEach(middleware => {
			registry.addGlobalMiddleware(middleware);
		});
	}

	// Store registry in state for persistence
	setState('restMatcher.registry', registry);

	return {
		api: {
			// Endpoint management
			addEndpoint: (method, pattern, config) => registry.addEndpoint(method, pattern, config),
			removeEndpoint: (method, pattern) => registry.removeEndpoint(method, pattern),
			getEndpoints: (filters) => registry.getEndpoints(filters),

			// Group management
			addGroup: (name, config) => registry.addGroup(name, config),
			addToGroup: (groupName, endpoint) => registry.addToGroup(groupName, endpoint),

			// Middleware management
			addGlobalMiddleware: (middleware) => registry.addGlobalMiddleware(middleware),

			// Matching
			match: (method, path, options) => registry.match(method, path, options),
			matchUrl: (url, method = 'GET') => {
				const urlObj = new URL(url, 'http://localhost');
				return registry.match(method, urlObj.pathname, {
					queryString: urlObj.search.slice(1)
				});
			},

			// Path building
			buildPath: (pattern, params = {}) => {
				let path = pattern;
				Object.entries(params).forEach(([key, value]) => {
					path = path.replace(new RegExp(`:${key}\\??`, 'g'), encodeURIComponent(value));
				});
				return path;
			},

			// Validation
			validatePath: (pattern) => {
				try {
					registry.parser.parse(pattern);
					return { valid: true };
				} catch (error) {
					return { valid: false, error: error.message };
				}
			},

			// Statistics and monitoring
			getStats: () => registry.getStats(),
			clearCache: () => registry.clearCache(),

			// Schema management
			exportSchema: () => registry.exportSchema(),
			importSchema: (schema) => registry.importSchema(schema),

			// Testing utilities
			testEndpoint: (method, pattern, testPaths) => {
				const endpoint = registry.endpoints.get(`${method}:${pattern}`);
				if (!endpoint) return { error: 'Endpoint not found' };

				return testPaths.map(path => ({
					path,
					result: registry.match(method, path)
				}));
			},

			// Advanced querying
			findConflicts: () => {
				const endpoints = Array.from(registry.endpoints.values());
				const conflicts = [];

				for (let i = 0; i < endpoints.length; i++) {
					for (let j = i + 1; j < endpoints.length; j++) {
						const a = endpoints[i];
						const b = endpoints[j];

						if (a.method === b.method) {
							// Test if patterns could conflict
							const testPaths = ['/test/123', '/api/users/456', '/admin/settings'];
							const aMatches = testPaths.filter(path =>
								registry.parser.extractParams(a.parsedRoute, path) !== null
							);
							const bMatches = testPaths.filter(path =>
								registry.parser.extractParams(b.parsedRoute, path) !== null
							);

							const overlap = aMatches.filter(path => bMatches.includes(path));
							if (overlap.length > 0) {
								conflicts.push({
									endpointA: a.pattern,
									endpointB: b.pattern,
									method: a.method,
									conflictingPaths: overlap
								});
							}
						}
					}
				}

				return conflicts;
			},

			// Direct registry access for advanced usage
			getRegistry: () => registry
		}
	};
};

// Export for use in Juris apps
if (typeof module !== 'undefined' && module.exports) {
	module.exports = { RestMatcherComponent };
} else if (typeof window !== 'undefined') {
	window.RestMatcherComponent = RestMatcherComponent;
}