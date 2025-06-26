// app.js - Secure Juris App with StringRenderer and SimpleRouter
(function () {
	'use strict';

	// Universal Juris import
	let Juris;
	if (typeof module !== 'undefined' && module.exports) {
		// Node.js environment
		Juris = require('../juris/juris.js');
	} else {
		// Browser environment
		Juris = window.Juris;
	}

	// StringRenderer Headless Component with StringRenderer class inside
	// StringRenderer Headless Component with proper component handling
	const StringRendererComponent = (props, context) => {
		const { getState, juris } = context;

		const originalDOMRenderer = juris.domRenderer;

		// Enhanced StringRenderer with proper attribute handling and component support
		class StringRenderer {
			constructor(juris = null) {
				this.renderMode = 'string';
				this.juris = juris; // Set from constructor parameter
				this.renderDepth = 0;
				this.maxRenderDepth = 100;

				// Boolean attributes that should be rendered without values when true
				this.booleanAttributes = new Set([
					'autofocus', 'autoplay', 'async', 'checked', 'controls', 'defer',
					'disabled', 'hidden', 'loop', 'multiple', 'muted', 'open',
					'readonly', 'required', 'reversed', 'selected', 'default'
				]);

				// Attributes that should be skipped completely
				this.skipAttributes = new Set([
					'children', 'text', 'style', 'key'
				]);

				// Event handler patterns (attributes starting with 'on')
				this.eventHandlerPattern = /^on[a-z]/i;
			}

			render(vnode, context = null) {
				if (this.renderDepth > this.maxRenderDepth) {
					console.warn('StringRenderer: Maximum render depth exceeded');
					return '<!-- Max render depth exceeded -->';
				}

				this.renderDepth++;

				try {
					const result = this._renderInternal(vnode, context);
					this.renderDepth--;
					return result;
				} catch (error) {
					this.renderDepth--;
					console.error('StringRenderer: Render error:', error);
					return `<!-- Render error: ${error.message} -->`;
				}
			}

			_renderInternal(vnode, context) {
				if (!vnode) {
					return '';
				}

				if (typeof vnode !== 'object') {
					return this._escapeHtml(String(vnode));
				}

				if (Array.isArray(vnode)) {
					return vnode.map(child => this.render(child, context)).join('');
				}

				const tagName = Object.keys(vnode)[0];
				if (!tagName) {
					return '';
				}

				const nodeProps = vnode[tagName] || {};

				// Check if it's a component - FIXED: ensure juris and componentManager exist
				if (this.juris && this.juris.componentManager && this.juris.componentManager.components.has(tagName)) {
					return this._renderComponent(tagName, nodeProps, context);
				}

				// Render as regular HTML element
				return this._renderElement(tagName, nodeProps, context);
			}

			_renderComponent(tagName, props, parentContext) {
				try {
					const componentFn = this.juris.componentManager.components.get(tagName);

					// Create proper context for component - FIXED: use juris.createContext
					let componentContext = parentContext;
					if (!componentContext) {
						componentContext = this.juris.createContext();
					}

					// Execute component function
					const componentResult = componentFn(props, componentContext);

					if (!componentResult) {
						return '';
					}

					// Handle component that returns { render: function } pattern
					if (componentResult.render && typeof componentResult.render === 'function') {
						try {
							const renderResult = componentResult.render();
							return this.render(renderResult, componentContext);
						} catch (renderError) {
							console.error(`StringRenderer: Error in component ${tagName} render method:`, renderError);
							return `<!-- Component ${tagName} render error: ${renderError.message} -->`;
						}
					}

					// Handle direct vnode return
					if (typeof componentResult === 'object' && componentResult !== null) {
						const keys = Object.keys(componentResult);
						if (keys.length > 0) {
							const firstKey = keys[0];

							// Check if it's a valid HTML tag or component
							const isValidTag = /^[a-z][a-z0-9]*$/i.test(firstKey) ||
								/^[A-Z][a-zA-Z0-9]*$/.test(firstKey) ||
								(this.juris && this.juris.componentManager && this.juris.componentManager.components.has(firstKey));

							if (isValidTag) {
								return this.render(componentResult, componentContext);
							}
						}
					}

					return this._escapeHtml(String(componentResult));

				} catch (error) {
					console.error(`StringRenderer: Error rendering component ${tagName}:`, error);
					return `<!-- Component ${tagName} error: ${error.message} -->`;
				}
			}

			_renderElement(tagName, props, context) {
				let html = `<${tagName}`;

				// Handle all attributes except special ones
				const processedAttributes = this._processAttributes(props, context);
				html += processedAttributes;

				// Handle style attribute separately
				const styleStr = this._renderStyle(props.style, context);
				if (styleStr) {
					html += ` style="${this._escapeAttributeValue(styleStr)}"`;
				}

				html += '>';

				// Handle content
				if (props.text !== undefined) {
					const text = typeof props.text === 'function'
						? this._evaluateFunction(props.text, context)
						: props.text;
					html += this._escapeHtml(String(text));
				} else if (props.children !== undefined) {
					let children = props.children;

					if (typeof children === 'function') {
						try {
							children = this._evaluateFunction(children, context);
						} catch (e) {
							console.error('StringRenderer: Error evaluating children function:', e);
							children = [];
						}
					}

					if (Array.isArray(children)) {
						html += children.map(child => this.render(child, context)).join('');
					} else if (children !== null && children !== undefined) {
						html += this.render(children, context);
					}
				}

				if (!this._isVoidElement(tagName)) {
					html += `</${tagName}>`;
				}

				return html;
			}

			_processAttributes(props, context) {
				let attributesHtml = '';

				Object.keys(props).forEach(key => {
					// Skip special attributes and event handlers
					if (this._shouldSkipAttribute(key)) {
						return;
					}

					const value = props[key];
					let processedValue = value;

					// Evaluate functions
					if (typeof value === 'function') {
						try {
							processedValue = this._evaluateFunction(value, context);
						} catch (e) {
							console.warn(`StringRenderer: Error evaluating attribute ${key}:`, e);
							return;
						}
					}

					// Handle different attribute types
					attributesHtml += this._renderAttribute(key, processedValue);
				});

				return attributesHtml;
			}

			_renderAttribute(name, value) {
				// Handle null/undefined values
				if (value === null || value === undefined) {
					return '';
				}

				const lowerName = name.toLowerCase();

				// Handle boolean attributes - aligned with DOMRenderer logic
				if (this.booleanAttributes.has(lowerName)) {
					// For boolean attributes, render the attribute name only if truthy
					if (value === true || value === '' || value === name || value === lowerName) {
						return ` ${name}`;
					} else if (value === false) {
						return '';
					} else {
						// For non-boolean values on boolean attributes, treat as regular attribute
						return ` ${name}="${this._escapeAttributeValue(value)}"`;
					}
				}

				// Handle data- and aria- attributes (always render with value)
				if (lowerName.startsWith('data-') || lowerName.startsWith('aria-')) {
					return ` ${name}="${this._escapeAttributeValue(value)}"`;
				}

				// Handle special cases - aligned with DOMRenderer _setStaticAttribute
				switch (lowerName) {
					case 'class':
					case 'classname':
						// Handle class arrays or objects
						const className = this._processClassName(value);
						return className ? ` class="${this._escapeAttributeValue(className)}"` : '';

					case 'for':
					case 'htmlfor':
						// Convert htmlFor to for
						return ` for="${this._escapeAttributeValue(value)}"`;

					case 'tabindex':
						// Ensure tabindex is a number - aligned with DOMRenderer
						const tabIndex = parseInt(value, 10);
						return isNaN(tabIndex) ? '' : ` tabindex="${tabIndex}"`;

					case 'value':
						// Handle form control values
						return ` value="${this._escapeAttributeValue(value)}"`;

					case 'type':
						// Input type attribute
						return ` type="${this._escapeAttributeValue(value)}"`;

					case 'id':
						// ID attribute
						return ` id="${this._escapeAttributeValue(value)}"`;

					case 'name':
						// Name attribute
						return ` name="${this._escapeAttributeValue(value)}"`;

					case 'placeholder':
						// Placeholder attribute
						return ` placeholder="${this._escapeAttributeValue(value)}"`;

					case 'title':
						// Title attribute
						return ` title="${this._escapeAttributeValue(value)}"`;

					case 'alt':
						// Alt attribute for images
						return ` alt="${this._escapeAttributeValue(value)}"`;

					case 'src':
						// Src attribute for images/scripts
						return ` src="${this._escapeAttributeValue(value)}"`;

					case 'href':
						// Href attribute for links
						return ` href="${this._escapeAttributeValue(value)}"`;

					case 'target':
						// Target attribute for links
						return ` target="${this._escapeAttributeValue(value)}"`;

					case 'rel':
						// Rel attribute for links
						return ` rel="${this._escapeAttributeValue(value)}"`;

					case 'role':
						// ARIA role attribute
						return ` role="${this._escapeAttributeValue(value)}"`;

					case 'contenteditable':
						// ContentEditable attribute
						return ` contenteditable="${this._escapeAttributeValue(value)}"`;

					case 'draggable':
						// Draggable attribute
						return ` draggable="${this._escapeAttributeValue(value)}"`;

					case 'spellcheck':
						// Spellcheck attribute
						return ` spellcheck="${this._escapeAttributeValue(value)}"`;

					default:
						// Regular attributes
						return ` ${name}="${this._escapeAttributeValue(value)}"`;
				}
			}

			_processClassName(value) {
				if (typeof value === 'string') {
					return value.trim();
				}

				if (Array.isArray(value)) {
					return value
						.filter(cls => cls && typeof cls === 'string')
						.map(cls => cls.trim())
						.filter(cls => cls.length > 0)
						.join(' ');
				}

				if (typeof value === 'object' && value !== null) {
					return Object.entries(value)
						.filter(([cls, condition]) => condition && cls)
						.map(([cls]) => cls.trim())
						.filter(cls => cls.length > 0)
						.join(' ');
				}

				return '';
			}

			_shouldSkipAttribute(key) {
				// Skip special props, style (handled separately), and event handlers
				return this.skipAttributes.has(key) ||
					this.eventHandlerPattern.test(key) ||
					key === 'style';
			}

			_isVoidElement(tagName) {
				const voidElements = new Set([
					'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
					'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
				]);
				return voidElements.has(tagName.toLowerCase());
			}

			_evaluateFunction(fn, context) {
				if (typeof fn !== 'function') {
					return fn;
				}

				try {
					return fn.call(context);
				} catch (error) {
					console.warn('StringRenderer: Function evaluation error:', error);
					console.warn('Context available:', context ? Object.keys(context) : 'No context');
					return '';
				}
			}

			_renderStyle(style, context) {
				if (!style) {
					return '';
				}

				if (typeof style === 'function') {
					try {
						style = this._evaluateFunction(style, context);
					} catch (e) {
						console.warn('StringRenderer: Style function evaluation error:', e);
						return '';
					}
				}

				if (typeof style === 'object' && style !== null) {
					return Object.entries(style)
						.map(([prop, value]) => {
							let cssValue = value;
							if (typeof value === 'function') {
								cssValue = this._evaluateFunction(value, context);
							}

							// Skip undefined/null values
							if (cssValue === undefined || cssValue === null) {
								return '';
							}

							const cssProp = this._camelToKebab(prop);
							return `${cssProp}: ${cssValue}`;
						})
						.filter(rule => rule && !rule.endsWith(': undefined') && !rule.endsWith(': null'))
						.join('; ');
				}

				return String(style);
			}

			_camelToKebab(str) {
				return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
			}

			_escapeHtml(str) {
				if (str == null) {
					return '';
				}
				return String(str)
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;')
					.replace(/'/g, '&#39;');
			}

			_escapeAttributeValue(value) {
				if (value == null) {
					return '';
				}
				return String(value)
					.replace(/&/g, '&amp;')
					.replace(/"/g, '&quot;')
					.replace(/'/g, '&#39;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
			}

			// Main renderToString method - the primary public API
			renderToString(layout, context = null) {
				if (!layout) {
					return '<p>No layout provided</p>';
				}

				try {
					return this.render(layout, context);
				} catch (error) {
					console.error('StringRenderer renderToString error:', error);
					return `<div style="color: red;">StringRenderer Error: ${error.message}</div>`;
				}
			}

			// Interface compatibility methods
			cleanup() {
				this.renderDepth = 0;
				return '';
			}

			setRenderMode(mode) {
				this.renderMode = mode;
			}

			getRenderMode() {
				return this.renderMode;
			}

			isFineGrained() {
				return false;
			}

			isBatchMode() {
				return false;
			}

			updateElementContent() {
				return '';
			}

			// Properties for interface compatibility
			subscriptions = new WeakMap();
			eventMap = {};
			elementCache = new Map();
			recyclePool = new Map();
			renderQueue = [];
			isRendering = false;
			scheduledRender = null;
		}

		// Create instance of StringRenderer with juris reference - FIXED!
		const stringRenderer = new StringRenderer(juris);

		return {
			api: {
				enableStringRenderer() {
					juris.domRenderer = stringRenderer;
					return stringRenderer;
				},
				enableDOMRenderer() {
					juris.domRenderer = originalDOMRenderer;
					return originalDOMRenderer;
				},
				getCurrentRenderer() {
					return juris.domRenderer === stringRenderer ? 'string' : 'dom';
				},
				renderToString(layout) {
					const layoutToRender = layout || juris.layout;
					if (!layoutToRender) {
						return '<p>No layout provided</p>';
					}

					try {
						// Use the stringRenderer instance that has juris reference
						return stringRenderer.render(layoutToRender);
					} catch (error) {
						console.error('StringRenderer renderToString error:', error);
						return `<div style="color: red;">StringRenderer Error: ${error.message}</div>`;
					}
				},
				stringRenderer,
				originalDOMRenderer
			}
		};
	};

	// SimpleRouter Headless Component
	const SimpleRouter = (props, context) => {
		const { setState, getState, juris } = context;

		const parseRoute = (route) => {
			if (!route || typeof route !== 'string') {
				return { path: '/', params: {}, query: {} };
			}

			const [pathAndQuery] = route.split('#');
			const [path, queryString] = pathAndQuery.split('?');

			const params = {};
			const query = {};

			if (queryString) {
				queryString.split('&').forEach(pair => {
					const [key, value] = pair.split('=');
					if (key) {
						query[decodeURIComponent(key)] = decodeURIComponent(value || '');
					}
				});
			}

			return { path: path || '/', params, query };
		};

		const matchRoute = (currentPath, routePattern) => {
			const currentSegments = currentPath.split('/').filter(Boolean);
			const patternSegments = routePattern.split('/').filter(Boolean);

			if (currentSegments.length !== patternSegments.length) {
				return null;
			}

			const params = {};

			for (let i = 0; i < patternSegments.length; i++) {
				const pattern = patternSegments[i];
				const current = currentSegments[i];

				if (pattern.startsWith(':')) {
					params[pattern.slice(1)] = current;
				} else if (pattern !== current) {
					return null;
				}
			}

			return params;
		};

		const api = {
			setRoute(route) {
				const parsed = parseRoute(route);

				const preservePaths = props.preserveOnRoute || [];

				setState('route', {
					current: route,
					path: parsed.path,
					params: parsed.params,
					query: parsed.query
				});

				return getState('route');
			},

			getRoute() {
				return getState('route', {});
			},

			navigate(route) {
				this.setRoute(route);

				if (typeof window !== 'undefined' && window.history) {
					window.history.pushState({}, '', route);
				}

				return this.getRoute();
			},

			replace(route) {
				this.setRoute(route);

				if (typeof window !== 'undefined' && window.history) {
					window.history.replaceState({}, '', route);
				}

				return this.getRoute();
			},

			buildUrl(pattern, params = {}, query = {}) {
				let url = pattern;

				Object.entries(params).forEach(([key, value]) => {
					url = url.replace(`:${key}`, encodeURIComponent(value));
				});

				const queryString = Object.entries(query)
					.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
					.join('&');

				if (queryString) {
					url += `?${queryString}`;
				}

				return url;
			},

			matches(pattern) {
				const route = this.getRoute();
				return matchRoute(route.path, pattern) !== null;
			},

			getParams(pattern) {
				const route = this.getRoute();
				return matchRoute(route.path, pattern) || {};
			}
		};

		return {
			api: api,
			hooks: {
				onRegister() {
					if (typeof window !== 'undefined') {
						window.addEventListener('popstate', () => {
							const currentRoute = window.location.pathname + window.location.search;
							api.setRoute(currentRoute);
						});

						const initialRoute = window.location.pathname + window.location.search;
						api.setRoute(initialRoute);
					}
				}
			}
		};
	};

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
				Router: {
					fn: SimpleRouter,
					options: {
						preserveOnRoute: ['user'],
						autoInit: true
					}
				}
			},

			components: {
				// Add MultiStateRenderer component
				MultiStateRenderer: (props, context) => ({
					render: () => ({
						div: {
							children: () => {
								// Check conditions in order and return first match
								if (props.conditions) {
									for (const condition of props.conditions) {
										const test = typeof condition.when === 'function'
											? condition.when()
											: condition.when;

										if (test) {
											return condition.render ?
												(Array.isArray(condition.render) ? condition.render : [condition.render]) :
												[];
										}
									}
								}

								// No conditions matched, return fallback
								return props.fallback ?
									(Array.isArray(props.fallback) ? props.fallback : [props.fallback]) :
									[];
							}
						}
					})
				}),

				// Navigation remains the same
				Nav: (props, { headless }) => ({
					nav: {
						style: { padding: '16px', borderBottom: '1px solid #ccc' },
						children: () => [{
							a: {
								href: '/',
								onclick: (e) => {
									e.preventDefault();
									headless.Router.navigate('/');
								},
								text: 'Home',
								style: { marginRight: '16px' }
							}
						}, {
							a: {
								href: '/about',
								onclick: (e) => {
									e.preventDefault();
									headless.Router.navigate('/about');
								},
								text: 'About',
								style: { marginRight: '16px' }
							}
						}, {
							a: {
								href: '/todos',
								onclick: (e) => {
									e.preventDefault();
									headless.Router.navigate('/todos');
								},
								text: 'Todos',
								style: { marginRight: '16px' }
							}
						}, {
							a: {
								href: '/user/123',
								onclick: (e) => {
									e.preventDefault();
									headless.Router.navigate('/user/123');
								},
								text: 'User Profile'
							}
						}]
					}
				}),

				// Simplified page components - no routing logic
				HomePage: (props, { getState, setState }) => ({
					div: {
						style: { padding: '20px' },
						children: () => [{
							h1: { text: 'Welcome Home!' }
						}, {
							div: {
								style: { marginTop: '20px' },
								children: () => [{
									h2: { text: () => `Counter: ${getState('counter', 0)}` }
								}, {
									button: {
										text: 'Increment',
										onclick: () => setState('counter', getState('counter', 0) + 1),
										style: { padding: '8px 16px', marginRight: '8px' }
									}
								}, {
									button: {
										text: 'Reset',
										onclick: () => setState('counter', 0),
										style: { padding: '8px 16px' }
									}
								}]
							}
						}]
					}
				}),

				AboutPage: () => ({
					div: {
						style: { padding: '20px' },
						children: () => [{
							h1: { text: 'About Us' }
						}, {
							p: { text: 'This is a sample Juris application with StringRenderer and SimpleRouter.' }
						}]
					}
				}),

				TodosPage: (props, { getState, setState }) => ({
					div: {
						style: { padding: '20px' },
						children: () => [{
							h1: { text: 'Todo List' }
						}, {
							input: {
								type: 'text',
								placeholder: 'Add new todo...',
								onkeypress: (e) => {
									if (e.key === 'Enter') {
										const text = e.target.value.trim();
										if (text) {
											const todos = getState('todos', []);
											setState('todos', [...todos, { id: Date.now(), text, done: false }]);
											e.target.value = '';
										}
									}
								},
								style: { padding: '8px', width: '300px', marginBottom: '16px' }
							}
						}, {
							div: {
								children: () => {
									const todos = getState('todos', []);
									return todos.map(todo => ({
										div: {
											key: todo.id,
											style: {
												padding: '8px',
												border: '1px solid #eee',
												marginBottom: '4px',
												display: 'flex',
												alignItems: 'center'
											},
											children: () => [{
												input: {
													type: 'checkbox',
													checked: todo.done,
													onchange: (e) => {
														const todos = getState('todos', []);
														setState('todos', todos.map(t =>
															t.id === todo.id ? { ...t, done: e.target.checked } : t
														));
													},
													style: { marginRight: '8px' }
												}
											}, {
												span: {
													text: todo.text,
													style: {
														textDecoration: todo.done ? 'line-through' : 'none',
														flex: 1
													}
												}
											}, {
												button: {
													text: 'Delete',
													onclick: () => {
														const todos = getState('todos', []);
														setState('todos', todos.filter(t => t.id !== todo.id));
													},
													style: { padding: '4px 8px', marginLeft: '8px' }
												}
											}]
										}
									}));
								}
							}
						}]
					}
				}),

				UserPage: (props, { getState, setState, headless }) => {
					const params = headless.Router.getParams('/user/:id');
					return {
						div: {
							style: { padding: '20px' },
							children: () => [{
								h1: { text: `User Profile #${params.id}` }
							}, {
								div: {
									children: () => [{
										p: { text: () => `Name: ${getState('user.name', 'Guest')}` }
									}, {
										p: { text: () => `Status: ${getState('user.isLoggedIn', false) ? 'Logged In' : 'Guest'}` }
									}, {
										button: {
											text: () => getState('user.isLoggedIn', false) ? 'Logout' : 'Login',
											onclick: () => {
												const isLoggedIn = getState('user.isLoggedIn', false);
												setState('user.isLoggedIn', !isLoggedIn);
												setState('user.name', !isLoggedIn ? `User ${params.id}` : 'Guest');
											},
											style: { padding: '8px 16px' }
										}
									}]
								}
							}]
						}
					};
				},

				// Router component using MultiStateRenderer
				Router: (props, { headless }) => ({
					MultiStateRenderer: {
						conditions: [
							{
								when: () => headless.Router.matches('/'),
								render: [{ HomePage: {} }]
							},
							{
								when: () => headless.Router.matches('/about'),
								render: [{ AboutPage: {} }]
							},
							{
								when: () => headless.Router.matches('/todos'),
								render: [{ TodosPage: {} }]
							},
							{
								when: () => {
									const params = headless.Router.getParams('/user/:id');
									return Object.keys(params).length > 0;
								},
								render: [{ UserPage: {} }]
							}
						],
						fallback: [{
							div: {
								style: { padding: '20px' },
								children: () => [{
									h1: { text: '404 - Page Not Found' }
								}, {
									p: { text: 'The page you are looking for does not exist.' }
								}]
							}
						}]
					}
				}),

				// Main App Layout
				App: (props, { getState }) => ({
					div: {
						children: () => [{
							Nav: {}
						}, {
							Router: {}
						}, {
							div: {
								style: { padding: '20px' },
								text: () => `Hydrated and rendered in ${getState('matrics.renderedTime', 'Rendering time not set')}ms`

							}
						}]
					}
				})
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
		module.exports = { createApp, StringRendererComponent, SimpleRouter };
	}

	// Only expose createApp factory for server hydration
	if (typeof window !== 'undefined') {
		window.createApp = createApp;
	}

})();