// Universal API Client - Works on both server and client
// Minimal configuration, maximum flexibility
// Location: source/headless/server-client-fetch-api.js
// Core API client that works everywhere
const createAPIClient = (config = {}) => {
	const {
		baseURL = '',
		defaultHeaders = {},
		timeout = 10000,
		retries = 1,
		interceptors = {}
	} = config;

	// Universal fetch wrapper - Server-aware for local API calls
	const universalFetch = async (url, options = {}) => {
		// Check if we're on server side
		const isServer = typeof process !== 'undefined' && process.versions && process.versions.node;

		let fetchFn;

		// Server-side: Handle local API calls differently
		if (isServer) {
			const fullURL = url.startsWith('http') ? url : `${baseURL}${url}`;

			// If it's a local API call (starts with /api), handle it with database services
			if (fullURL.startsWith('/api') || (baseURL === '' && url.startsWith('/api'))) {

				try {
					const method = options.method || 'GET';
					const { resource, id, action } = parseAPIPath(url, method);

					if (!resource) {
						return {
							ok: false,
							status: 400,
							statusText: 'Bad Request',
							json: async () => ({ error: 'Invalid API path' })
						};
					}

					// Parse request body if present
					let body = null;
					if (options.body && typeof options.body === 'string') {
						try {
							body = JSON.parse(options.body);
						} catch (e) {
							body = options.body;
						}
					} else if (options.body) {
						body = options.body;
					}

					// Extract query parameters from URL
					const urlObj = new URL(url, 'http://localhost');
					const queryParams = {};
					urlObj.searchParams.forEach((value, key) => {
						queryParams[key] = value;
					});

					// Add ID to params if present
					if (id) {
						queryParams.id = id;
					}

					// Execute the database service
					const result = await executeService(resource, action, queryParams, body);

					return {
						ok: true,
						status: 200,
						statusText: 'OK',
						json: async () => result,
						headers: new Map([['content-type', 'application/json']])
					};

				} catch (error) {
					console.error('API Service Error:', error);

					const status = error.message.includes('not found') ? 404 : 500;
					return {
						ok: false,
						status,
						statusText: error.message,
						json: async () => ({
							error: error.message,
							stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
						})
					};
				}
			}

			// For external APIs on server, use Node.js fetch
			if (typeof globalThis.fetch === 'function') {
				fetchFn = globalThis.fetch;
			} else if (typeof global !== 'undefined' && typeof global.fetch === 'function') {
				fetchFn = global.fetch;
			} else if (typeof fetch === 'function') {
				fetchFn = fetch;
			} else {
				try {
					fetchFn = require('node-fetch');
				} catch (error) {
					throw new Error('Fetch not available. Please ensure you are using Node.js 18+ or install node-fetch: npm install node-fetch');
				}
			}
		} else {
			// Client-side: Use browser fetch
			fetchFn = window.fetch;
		}

		if (!fetchFn) {
			throw new Error('Fetch not available in this environment');
		}

		const fullURL = url.startsWith('http') ? url : `${baseURL}${url}`;

		const finalOptions = {
			timeout,
			...options,
			headers: {
				'Content-Type': 'application/json',
				...defaultHeaders,
				...options.headers
			}
		};

		// Apply request interceptor
		if (interceptors.request) {
			const intercepted = await interceptors.request(fullURL, finalOptions);
			if (intercepted) {
				return intercepted;
			}
		}

		let lastError;
		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				const response = await fetchFn(fullURL, finalOptions);

				// Apply response interceptor
				if (interceptors.response) {
					const intercepted = await interceptors.response(response.clone());
					if (intercepted) return intercepted;
				}

				return response;
			} catch (error) {
				lastError = error;
				if (attempt < retries) {
					await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
				}
			}
		}
		throw lastError;
	};

	// Core methods
	const api = {
		get: (url, options = {}) =>
			universalFetch(url, { ...options, method: 'GET' }),

		post: (url, data, options = {}) =>
			universalFetch(url, {
				...options,
				method: 'POST',
				body: JSON.stringify(data)
			}),

		put: (url, data, options = {}) =>
			universalFetch(url, {
				...options,
				method: 'PUT',
				body: JSON.stringify(data)
			}),

		delete: (url, options = {}) =>
			universalFetch(url, { ...options, method: 'DELETE' }),

		// Raw fetch access
		fetch: universalFetch
	};

	return api;
};


// Execute database service method
const executeService = async (resource, action, params = {}, body = null) => {
	const path = require('path');
	const dbQuery = path.join(process.cwd(), 'services/db.query.js');
	const dbServices = require(dbQuery);
	const services = await dbServices.loadAPIServices();

	if (!services[resource]) {
		throw new Error(`Resource '${resource}' not found in API services`);
	}

	const serviceMethod = services[resource][action];
	if (!serviceMethod || typeof serviceMethod !== 'function') {
		throw new Error(`Method '${action}' not found for resource '${resource}'`);
	}

	try {
		// Prepare arguments for the service method
		let args = [];

		if (params.id) {
			args.push(params.id);
		}

		if (body) {
			args.push(body);
		}

		// Add any additional query parameters
		const { id, ...queryParams } = params;
		if (Object.keys(queryParams).length > 0) {
			args.push(queryParams);
		}

		// Execute the service method
		const result = await serviceMethod.apply(services[resource], args);
		return result;
	} catch (error) {
		console.error(`Error executing ${resource}.${action}:`, error);
		throw error;
	}
};
// Parse API path and extract resource/method info
const parseAPIPath = (url, method = 'GET') => {
	// Remove /api prefix and clean up path
	const cleanPath = url.replace(/^\/api\/?/, '');
	const segments = cleanPath.split('/').filter(Boolean);

	if (segments.length === 0) {
		return { resource: null, id: null, action: null };
	}

	const resource = segments[0]; // e.g., 'users', 'posts'
	let id = null;
	let action = null;

	// Handle different URL patterns:
	// /api/users -> users.findAll()
	// /api/users/123 -> users.findById(123)
	// /api/users/123/posts -> users.getPosts(123)

	if (segments.length === 1) {
		// /api/users
		action = method === 'GET' ? 'findAll' :
			method === 'POST' ? 'create' :
				method === 'DELETE' ? 'deleteAll' : 'findAll';
	} else if (segments.length === 2) {
		// /api/users/123
		id = segments[1];
		action = method === 'GET' ? 'findById' :
			method === 'PUT' || method === 'PATCH' ? 'update' :
				method === 'DELETE' ? 'delete' : 'findById';
	} else if (segments.length === 3) {
		// /api/users/123/posts
		id = segments[1];
		const subResource = segments[2];
		action = `get${subResource.charAt(0).toUpperCase() + subResource.slice(1)}`;
	}

	return { resource, id, action, segments };
};

const createAPIHandler = (customEndpoints = {}) => {
	return async (request, reply) => {
		try {
			const { method, url, query, body } = request;

			// Check for custom endpoints first
			const exactMatch = customEndpoints[url];
			if (exactMatch && exactMatch.method === method) {
				const result = await exactMatch.handler(body, query, request);
				reply.code(200);
				return result;
			}

			// Fall back to standard resource-based routing
			const { resource, id, action } = parseAPIPath(url, method);

			if (!resource) {
				reply.code(400);
				return { error: 'Invalid API path' };
			}

			const params = { ...query };
			if (id) params.id = id;

			const result = await executeService(resource, action, params, body);

			reply.code(200);
			return result;

		} catch (error) {
			console.error('API Error:', error);

			const status = error.message.includes('not found') ? 404 : 500;
			reply.code(status);

			return {
				error: error.message,
				stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
			};
		}
	};
};
// Headless API Manager for Juris (unchanged)
const createHeadlessAPI = (endpoints = {}, config = {}) => {
	return (props, context) => {
		const { getState, setState, subscribe, juris } = context;
		const client = createAPIClient(config);

		// Auto-generate methods from endpoints
		const api = {};

		Object.entries(endpoints).forEach(([name, endpoint]) => {
			const { method = 'GET', url, transform, cache } = endpoint;

			api[name] = async (params = {}, options = {}) => {
				const cacheKey = cache ? `api.${name}.${JSON.stringify(params)}` : null;

				// Check cache first
				if (cacheKey && !options.skipCache) {
					const cached = getState(cacheKey);
					if (cached) return cached;
				}

				// Set loading state
				setState(`api.${name}.loading`, true);
				try {
					// Build URL with params
					let finalURL = url;
					const queryParams = {};
					const bodyData = {};

					Object.entries(params).forEach(([key, value]) => {
						if (finalURL.includes(`{${key}}`)) {
							// Path parameter - replace in URL
							finalURL = finalURL.replace(`{${key}}`, encodeURIComponent(value));
						} else if (method === 'GET' || method === 'DELETE') {
							// Query parameter for GET/DELETE
							if (Array.isArray(value)) {
								// Handle array parameters (e.g., tags=[a,b,c])
								value.forEach(v => {
									if (!queryParams[key]) queryParams[key] = [];
									queryParams[key].push(v);
								});
							} else {
								queryParams[key] = value;
							}
						} else {
							// Body parameter for POST/PUT/PATCH
							bodyData[key] = value;
						}
					});

					// Build query string for GET/DELETE or when bodyData is empty
					const queryEntries = [];
					Object.entries(queryParams).forEach(([key, value]) => {
						if (Array.isArray(value)) {
							value.forEach(v => queryEntries.push([key, v]));
						} else {
							queryEntries.push([key, value]);
						}
					});

					const queryString = new URLSearchParams(queryEntries).toString();
					if (queryString) {
						finalURL += (finalURL.includes('?') ? '&' : '?') + queryString;
					}

					// Make request
					let response;
					if (method === 'GET' || method === 'DELETE') {
						response = await client[method.toLowerCase()](finalURL, options);
					} else {
						// POST/PUT/PATCH with body
						response = await client[method.toLowerCase()](finalURL, bodyData, options);
					}

					if (!response.ok) {
						throw new Error(`HTTP ${response.status}: ${response.statusText}`);
					}

					let data = await response.json();

					// Apply transform
					if (transform) {
						data = transform(data);
					}

					// Cache result
					if (cacheKey) {
						setState(cacheKey, data);
					}
					// Update state
					setState(`api.${name}.data`, data);
					setState(`api.${name}.error`, null);

					return data;
				} catch (error) {
					setState(`api.${name}.error`, error.message);
					throw error;
				} finally {
					setState(`api.${name}.loading`, false);
				}
			};
		});

		// Utility methods
		api.clearCache = (endpointName) => {
			if (endpointName) {
				// Clear specific endpoint states
				setState(`api.${endpointName}.data`, null);
				setState(`api.${endpointName}.loading`, false);
				setState(`api.${endpointName}.error`, null);

				// Also clear any cached responses
				const allApiState = getState('api', {});
				Object.keys(allApiState).forEach(key => {
					if (key.startsWith(`${endpointName}.`) && key.includes('cache')) {
						setState(`api.${key}`, null);
					}
				});
			} else {
				// Clear all API state
				const allApiState = getState('api', {});
				Object.keys(allApiState).forEach(key => {
					setState(`api.${key}`, null);
				});
			}
		};

		api.endpoints = () => {
			const result = {};

			Object.keys(endpoints).forEach(name => {
				result[name] = {
					data: getState(`api.${name}.data`),
					loading: getState(`api.${name}.loading`, false),
					error: getState(`api.${name}.error`)
				};
			});

			return result;
		};

		api.status = (endpointName) => ({
			data: getState(`api.${endpointName}.data`),
			loading: getState(`api.${endpointName}.loading`, false),
			error: getState(`api.${endpointName}.error`)
		});

		api.subscribe = (endpointName, callback) => {
			return subscribe(`api.${endpointName}`, callback);
		};

		return {
			api,
			hooks: {
				onRegister: () => {
					console.log('API client registered');
				}
			}
		};
	};
};

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
	module.exports = { createAPIClient, createHeadlessAPI, createAPIHandler, parseAPIPath };
} else if (typeof window !== 'undefined') {
	window.createAPIClient = createAPIClient;
	window.createHeadlessAPI = createHeadlessAPI;
	window.createAPIHandler = createAPIHandler;
	window.parseAPIPath = parseAPIPath;
}