class JurisAPI {
	constructor(config = {}) {
		this.endpoints = new Map();
		this.responses = new Map();
		this.config = config;
		this.middleware = [];
		this.interceptors = {
			request: [],
			response: []
		};
		this.createAPIHandler = null;
	}

	// Set endpoint configuration
	setEndpoint(url, config = {}) {
		const {
			method = 'GET',
			handler = null,
			middleware = [],
			schema = null,
			cache = false,
			transform = null,
			mock = null
		} = config;

		this.endpoints.set(url, {
			method: method.toUpperCase(),
			handler,
			middleware,
			schema,
			cache,
			transform,
			mock,
			url
		});

		return this;
	}

	// Set multiple endpoints at once
	setEndpoints(endpoints) {
		Object.entries(endpoints).forEach(([url, config]) => {
			this.setEndpoint(url, config);
		});
		return this;
	}

	// FIXED: Enhanced async endpoint response handling
	async getEndpointResponse(url, params = {}) {
		const endpoint = this.endpoints.get(url);
		if (!endpoint) {
			throw new Error(`Endpoint ${url} not found`);
		}

		// Return mock response if available
		if (endpoint.mock) {
			const mockResponse = typeof endpoint.mock === 'function'
				? await Promise.resolve(endpoint.mock(params))
				: endpoint.mock;

			this.responses.set(url, mockResponse);
			return mockResponse;
		}

		// Return cached response if available
		if (endpoint.cache && this.responses.has(url)) {
			return this.responses.get(url);
		}

		throw new Error(`No response available for ${url}. Set up handler or mock data.`);
	}

	// Add global middleware
	addMiddleware(middleware) {
		this.middleware.push(middleware);
		return this;
	}

	// Add request interceptor
	addRequestInterceptor(interceptor) {
		this.interceptors.request.push(interceptor);
		return this;
	}

	// Add response interceptor
	addResponseInterceptor(interceptor) {
		this.interceptors.response.push(interceptor);
		return this;
	}

	// Register endpoints with Fastify instance
	async registerWithFastify(fastify) {
		for (const [url, endpoint] of this.endpoints) {
			const routeOptions = {
				url,
				method: endpoint.method,
				schema: endpoint.schema,
				preHandler: [...this.middleware, ...endpoint.middleware],
				handler: this.createRouteHandler(endpoint)
			};

			fastify.route(routeOptions);
		}
	}

	// ENHANCED: Create route handler with better async support
	createRouteHandler(endpoint) {
		return async (request, reply) => {
			try {
				// FIXED: Properly await request interceptors
				for (const interceptor of this.interceptors.request) {
					await Promise.resolve(interceptor(request, reply));
				}

				let result;

				// Use mock if available and in development
				if (endpoint.mock && process.env.NODE_ENV !== 'production') {
					result = typeof endpoint.mock === 'function'
						? await Promise.resolve(endpoint.mock(request, reply))
						: endpoint.mock;
				}
				// Use actual handler
				else if (endpoint.handler) {
					// FIXED: Ensure handler is properly awaited
					result = await Promise.resolve(endpoint.handler(request, reply));
				}
				// Return error if no handler
				else {
					reply.code(501);
					return { error: `Handler not implemented for ${endpoint.url}` };
				}

				// FIXED: Properly await transform if it's async
				if (endpoint.transform) {
					result = await Promise.resolve(endpoint.transform(result, request, reply));
				}

				// Cache response if enabled
				if (endpoint.cache) {
					this.responses.set(endpoint.url, result);
				}

				// FIXED: Properly await response interceptors
				for (const interceptor of this.interceptors.response) {
					const interceptorResult = await Promise.resolve(interceptor(result, request, reply));
					if (interceptorResult !== undefined) {
						result = interceptorResult;
					}
				}

				return result;

			} catch (error) {
				console.error(`API Error in ${endpoint.url}:`, error);
				reply.code(500);
				return {
					error: 'Internal Server Error',
					message: process.env.NODE_ENV !== 'production' ? error.message : undefined
				};
			}
		};
	}

	// Get all registered endpoints
	getEndpoints() {
		return Array.from(this.endpoints.entries()).map(([url, config]) => ({
			url,
			method: config.method,
			hasHandler: !!config.handler,
			hasMock: !!config.mock,
			cached: config.cache
		}));
	}

	// Clear cache
	clearCache(url = null) {
		if (url) {
			this.responses.delete(url);
		} else {
			this.responses.clear();
		}
	}
}

// Export the JurisAPI class
module.exports = JurisAPI;