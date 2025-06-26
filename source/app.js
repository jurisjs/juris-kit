// source/app.js - Simplified with external components

(function () {
	'use strict';
	// Get Juris from appropriate source depending on environment
	let Juris;
	if (typeof window !== 'undefined' && window.Juris) {
		// Browser environment - use global Juris from stitched bundle
		Juris = window.Juris;
	} else if (typeof module !== 'undefined' && module.exports) {
		// Node.js environment - require Juris module
		Juris = require('../juris/juris.js');
	} else {
		throw new Error('Juris not available in this environment');
	}

	const api = createHeadlessAPI({
		users: { url: '/api/users' },
		createUser: { method: 'POST', url: '/api/users' },
		userPosts: { url: '/api/users/{userId}/posts' },

		// Custom endpoints
		userByEmail: { url: '/api/users/findByEmail' },
		userProfile: { url: '/api/users/{id}/profile' },
		login: { method: 'POST', url: '/api/auth/login' },
		logout: { method: 'POST', url: '/api/auth/logout' },
		dashboardStats: { url: '/api/dashboard/getStats' },
		searchUsers: { url: '/api/search?type=users' },

		// Bulk operations
		bulkUpdateUsers: { method: 'PUT', url: '/api/users/bulkUpdate' },
		resetPassword: { method: 'POST', url: '/api/users/resetPassword' }
	});

	// Factory function to create app instances
	function createApp(initialState = {}) {
		return new Juris({
			states: {
				counter: 0,
				todos: [],
				user: { name: 'Guest', isLoggedIn: false },
				...initialState
			},
			headlessComponents: {
				StringRenderer: {
					fn: StringRendererComponent,
					options: { autoInit: true }
				},
				SwapAttributeComponent: {
					fn: SwapAttributeComponent,
					options: { autoInit: false }
				},
				Router: {
					fn: SimpleRouter,
					options: {
						preserveOnRoute: ['user'],
						autoInit: true
					}
				},
				api: {
					fn: api,
					options: {
						autoInit: true
					}
				}
			},
			components: {
				App,
				HomePage,
				TodosPage,
				UserPage,
				AboutPage,
				MultiStateRenderer,
				Router,
				Nav,
				SimpleRouter
			},

			layout: {
				div: {
					children: () => [{ App: {} }]
				}
			}
		});
	}

	// Client-side initialization - completely private
	if (typeof window !== 'undefined' && window.__hydration_data) {
		const startTime = performance.now();
		// Create isolated app instance for client
		const clientApp = createApp(window.__hydration_data);
		window.__juris = clientApp; // Store app instance globally
		console.log('Client app created with initial state:', window.__juris.stateManager.state.api);
		// Render immediately
		clientApp.render('#app');

		// Clean up hydration data
		delete window.__hydration_data;
		const endTime = performance.now();
		const totalMs = Math.round(endTime - startTime);
		clientApp.setState('matrics.renderedTime', totalMs);
		console.log('Client app hydrated securely');
	}

	// Server-side exports only
	if (typeof module !== 'undefined') {
		module.exports = { createApp, createHeadlessAPI, createAPIHandler, parseAPIPath };
	}

	// Only expose createApp factory for server hydration
	if (typeof window !== 'undefined') {
		window.createApp = createApp;
		window.createHeadlessAPI = createHeadlessAPI;
		window.createAPIHandler = createAPIHandler;
		window.parseAPIPath = parseAPIPath;
	}

})();