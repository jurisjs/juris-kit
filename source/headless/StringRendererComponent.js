// StringRenderer Headless Component with async component support - MINIMAL CHANGES
const StringRendererComponent = (props, context) => {
	const { getState, juris } = context;

	const originalDOMRenderer = juris.domRenderer;

	// Enhanced StringRenderer with async support - minimal changes to existing code
	class StringRenderer {
		constructor(juris = null) {
			this.renderMode = 'string';
			this.juris = juris;
			this.renderDepth = 0;
			this.maxRenderDepth = 100;
			this.specialAttributeHandlers = new Map();

			// Async detection and handling
			this.asyncDetected = false;
			this.asyncTimeout = 5000;
			this.asyncPlaceholder = '<!-- Loading... -->';

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

		getType() {
			return 'StringRendererComponent';
		}
		// MAIN ENTRY POINT - Auto-detects sync vs async and waits for promises
		render(vnode, context = null) {
			if (this.renderDepth > this.maxRenderDepth) {
				console.warn('StringRenderer: Maximum render depth exceeded');
				return '<!-- Max render depth exceeded -->';
			}

			this.renderDepth++;
			this.asyncDetected = false; // Reset for each render

			try {
				const result = this._renderInternal(vnode, context);
				this.renderDepth--;

				// If result is a promise, wait for it
				if (result && typeof result.then === 'function') {
					//console.log('StringRenderer: Promise detected, waiting for completion');
					return result;
				}

				// If async was detected during sync render, switch to async
				if (this.asyncDetected) {
					console.log('StringRenderer: Async detected, switching to async render');
					return this.renderAsync(vnode, context);
				}

				return result;
			} catch (error) {
				this.renderDepth--;
				console.error('StringRenderer: Render error:', error);
				return `<!-- Render error: ${error.message} -->`;
			}
		}

		// NEW: Async render method
		async renderAsync(vnode, context = null) {
			if (this.renderDepth > this.maxRenderDepth) {
				console.warn('StringRenderer: Maximum render depth exceeded');
				return '<!-- Max render depth exceeded -->';
			}

			this.renderDepth++;

			try {
				const result = await this._renderInternalAsync(vnode, context);
				this.renderDepth--;
				return result;
			} catch (error) {
				this.renderDepth--;
				console.error('StringRenderer: Async render error:', error);
				return `<!-- Async render error: ${error.message} -->`;
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
				const results = vnode.map(child => this.render(child, context));

				// Check if any results are promises
				const hasPromises = results.some(result => result && typeof result.then === 'function');

				if (hasPromises) {
					// Wait for all promises to resolve
					return Promise.all(results.map(result =>
						result && typeof result.then === 'function' ? result : Promise.resolve(result)
					)).then(resolvedResults => resolvedResults.join(''));
				}

				return results.join('');
			}

			const tagName = Object.keys(vnode)[0];
			if (!tagName) {
				return '';
			}

			const nodeProps = vnode[tagName] || {};

			// Check if it's a component
			if (this.juris && this.juris.componentManager && this.juris.componentManager.components.has(tagName)) {
				return this._renderComponent(tagName, nodeProps, context);
			}

			// Render as regular HTML element
			return this._renderElement(tagName, nodeProps, context);
		}

		// NEW: Async version of _renderInternal
		async _renderInternalAsync(vnode, context) {
			if (!vnode) {
				return '';
			}

			if (typeof vnode !== 'object') {
				return this._escapeHtml(String(vnode));
			}

			if (Array.isArray(vnode)) {
				const results = await Promise.all(
					vnode.map(child => this.renderAsync(child, context))
				);
				return results.join('');
			}

			const tagName = Object.keys(vnode)[0];
			if (!tagName) {
				return '';
			}

			const nodeProps = vnode[tagName] || {};

			// Check if it's a component
			if (this.juris && this.juris.componentManager && this.juris.componentManager.components.has(tagName)) {
				return await this._renderComponentAsync(tagName, nodeProps, context);
			}

			// Render as regular HTML element
			return await this._renderElementAsync(tagName, nodeProps, context);
		}

		_renderComponent(tagName, props, parentContext) {
			try {
				const componentFn = this.juris.componentManager.components.get(tagName);

				let componentContext = parentContext;
				if (!componentContext) {
					componentContext = this.juris.createContext();
				}

				// Execute component function
				const componentResult = componentFn(props, componentContext);

				// If component returned a promise, return it directly - let caller handle
				if (componentResult && typeof componentResult.then === 'function') {
					//console.log(`StringRenderer: Component ${tagName} returned promise, returning for waiting`);
					return componentResult.then(resolvedResult => {
						return this._processComponentResult(resolvedResult, tagName, componentContext);
					});
				}

				return this._processComponentResult(componentResult, tagName, componentContext);

			} catch (error) {
				console.error(`StringRenderer: Error rendering component ${tagName}:`, error);
				return `<!-- Component ${tagName} error: ${error.message} -->`;
			}
		}

		// Helper to process component result (sync or from resolved promise)
		_processComponentResult(componentResult, tagName, componentContext) {
			if (!componentResult) {
				return '';
			}

			// Handle component that returns { render: function } pattern
			if (componentResult.render && typeof componentResult.render === 'function') {
				try {
					const renderResult = componentResult.render();

					// If render result is a promise, return it
					if (renderResult && typeof renderResult.then === 'function') {
						return renderResult.then(resolvedRender => {
							return this.render(resolvedRender, componentContext);
						});
					}

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

					const isValidTag = /^[a-z][a-z0-9]*$/i.test(firstKey) ||
						/^[A-Z][a-zA-Z0-9]*$/.test(firstKey) ||
						(this.juris && this.juris.componentManager && this.juris.componentManager.components.has(firstKey));

					if (isValidTag) {
						return this.render(componentResult, componentContext);
					}
				}
			}

			return this._escapeHtml(String(componentResult));
		}

		// NEW: Async component rendering
		async _renderComponentAsync(tagName, props, parentContext) {
			try {
				const componentFn = this.juris.componentManager.components.get(tagName);

				let componentContext = parentContext;
				if (!componentContext) {
					componentContext = this.juris.createContext();
				}

				// Execute component function and await if necessary
				const componentResult = await componentFn(props, componentContext);

				if (!componentResult) {
					return '';
				}

				// Handle component that returns { render: function } pattern
				if (componentResult.render && typeof componentResult.render === 'function') {
					try {
						const renderResult = await componentResult.render();
						return await this.renderAsync(renderResult, componentContext);
					} catch (renderError) {
						console.error(`StringRenderer: Error in async component ${tagName} render method:`, renderError);
						return `<!-- Component ${tagName} async render error: ${renderError.message} -->`;
					}
				}

				// Handle direct vnode return
				if (typeof componentResult === 'object' && componentResult !== null) {
					const keys = Object.keys(componentResult);
					if (keys.length > 0) {
						const firstKey = keys[0];

						const isValidTag = /^[a-z][a-z0-9]*$/i.test(firstKey) ||
							/^[A-Z][a-zA-Z0-9]*$/.test(firstKey) ||
							(this.juris && this.juris.componentManager && this.juris.componentManager.components.has(firstKey));

						if (isValidTag) {
							return await this.renderAsync(componentResult, componentContext);
						}
					}
				}

				return this._escapeHtml(String(componentResult));

			} catch (error) {
				console.error(`StringRenderer: Error rendering async component ${tagName}:`, error);
				return `<!-- Async component ${tagName} error: ${error.message} -->`;
			}
		}

		_renderElement(tagName, props, context) {
			let html = `<${tagName}`;

			// Handle all attributes except special ones
			const processedAttributes = this._processAttributes(props, context);

			// Check if attributes processing returned a promise
			if (processedAttributes && typeof processedAttributes.then === 'function') {
				return processedAttributes.then(attrs => {
					return this._continueElementRendering(tagName, props, context, attrs);
				});
			}

			return this._continueElementRendering(tagName, props, context, processedAttributes);
		}

		// Helper to continue element rendering after attributes are processed
		_continueElementRendering(tagName, props, context, processedAttributes) {
			let html = `<${tagName}`;
			html += processedAttributes;

			// Handle style attribute separately
			const styleStr = this._renderStyle(props.style, context);

			// Check if style rendering returned a promise
			if (styleStr && typeof styleStr.then === 'function') {
				return styleStr.then(resolvedStyle => {
					if (resolvedStyle) {
						html += ` style="${this._escapeAttributeValue(resolvedStyle)}"`;
					}
					html += '>';
					return this._renderElementContent(tagName, props, context, html);
				});
			}

			if (styleStr) {
				html += ` style="${this._escapeAttributeValue(styleStr)}"`;
			}

			html += '>';

			return this._renderElementContent(tagName, props, context, html);
		}

		// Helper to render element content
		_renderElementContent(tagName, props, context, htmlSoFar) {
			let contentPromise = null;

			// Handle content
			if (props.text !== undefined) {
				const text = typeof props.text === 'function'
					? this._evaluateFunction(props.text, context)
					: props.text;

				if (text && typeof text.then === 'function') {
					contentPromise = text.then(resolvedText => this._escapeHtml(String(resolvedText)));
				} else {
					const textContent = this._escapeHtml(String(text));
					return this._finalizeElement(tagName, htmlSoFar + textContent);
				}
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

				if (children && typeof children.then === 'function') {
					contentPromise = children.then(resolvedChildren => {
						return this._renderChildrenContent(resolvedChildren, context);
					});
				} else {
					const childrenResult = this._renderChildrenContent(children, context);

					if (childrenResult && typeof childrenResult.then === 'function') {
						contentPromise = childrenResult;
					} else {
						return this._finalizeElement(tagName, htmlSoFar + childrenResult);
					}
				}
			}

			if (contentPromise) {
				return contentPromise.then(content => {
					return this._finalizeElement(tagName, htmlSoFar + content);
				});
			}

			return this._finalizeElement(tagName, htmlSoFar);
		}

		// Helper to render children content
		_renderChildrenContent(children, context) {
			if (Array.isArray(children)) {
				const results = children.map(child => this.render(child, context));

				// Check if any results are promises
				const hasPromises = results.some(result => result && typeof result.then === 'function');

				if (hasPromises) {
					return Promise.all(results.map(result =>
						result && typeof result.then === 'function' ? result : Promise.resolve(result)
					)).then(resolvedResults => resolvedResults.join(''));
				}

				return results.join('');
			} else if (children !== null && children !== undefined) {
				return this.render(children, context);
			}

			return '';
		}

		// Helper to finalize element HTML
		_finalizeElement(tagName, html) {
			if (!this._isVoidElement(tagName)) {
				html += `</${tagName}>`;
			}
			return html;
		}

		// NEW: Async element rendering
		async _renderElementAsync(tagName, props, context) {
			let html = `<${tagName}`;

			// Handle all attributes except special ones
			const processedAttributes = await this._processAttributesAsync(props, context);
			html += processedAttributes;

			// Handle style attribute separately
			const styleStr = await this._renderStyleAsync(props.style, context);
			if (styleStr) {
				html += ` style="${this._escapeAttributeValue(styleStr)}"`;
			}

			html += '>';

			// Handle content
			if (props.text !== undefined) {
				const text = typeof props.text === 'function'
					? await this._evaluateFunctionAsync(props.text, context)
					: props.text;
				html += this._escapeHtml(String(text));
			} else if (props.children !== undefined) {
				let children = props.children;

				if (typeof children === 'function') {
					try {
						children = await this._evaluateFunctionAsync(children, context);
					} catch (e) {
						console.error('StringRenderer: Error evaluating async children function:', e);
						children = [];
					}
				}

				if (Array.isArray(children)) {
					const results = await Promise.all(
						children.map(child => this.renderAsync(child, context))
					);
					html += results.join('');
				} else if (children !== null && children !== undefined) {
					html += await this.renderAsync(children, context);
				}
			}

			if (!this._isVoidElement(tagName)) {
				html += `</${tagName}>`;
			}

			return html;
		}

		_processAttributes(props, context) {
			let attributesHtml = '';
			const attributePromises = [];

			Object.keys(props).forEach(key => {
				if (this.specialAttributeHandlers && this.specialAttributeHandlers.has(key)) {
					const handler = this.specialAttributeHandlers.get(key);
					const result = handler(key, props[key]);
					if (result) {
						attributesHtml += result;
					}
					return; // Skip normal processing
				}

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

						// If function returned a promise, collect it
						if (processedValue && typeof processedValue.then === 'function') {
							attributePromises.push(
								processedValue.then(resolvedValue => ({ key, value: resolvedValue }))
							);
							return;
						}
					} catch (e) {
						console.warn(`StringRenderer: Error evaluating attribute ${key}:`, e);
						return;
					}
				}

				// Handle different attribute types
				attributesHtml += this._renderAttribute(key, processedValue);
			});

			// If we have async attributes, wait for them
			if (attributePromises.length > 0) {
				return Promise.all(attributePromises).then(resolvedAttributes => {
					let asyncAttributesHtml = attributesHtml;
					resolvedAttributes.forEach(({ key, value }) => {
						asyncAttributesHtml += this._renderAttribute(key, value);
					});
					return asyncAttributesHtml;
				});
			}

			return attributesHtml;
		}

		// NEW: Async attribute processing
		async _processAttributesAsync(props, context) {
			let attributesHtml = '';

			for (const key of Object.keys(props)) {

				if (this.specialAttributeHandlers && this.specialAttributeHandlers.has(key)) {
					const handler = this.specialAttributeHandlers.get(key);
					const result = await handler(key, props[key]);
					if (result) {
						attributesHtml += result;
					}
					continue; // Skip normal processing
				}

				// Skip special attributes and event handlers
				if (this._shouldSkipAttribute(key)) {
					continue;
				}

				const value = props[key];
				let processedValue = value;

				// Evaluate functions
				if (typeof value === 'function') {
					try {
						processedValue = await this._evaluateFunctionAsync(value, context);
					} catch (e) {
						console.warn(`StringRenderer: Error evaluating async attribute ${key}:`, e);
						continue;
					}
				}

				// Handle different attribute types
				attributesHtml += this._renderAttribute(key, processedValue);
			}

			return attributesHtml;
		}

		_renderAttribute(name, value) {
			// Handle null/undefined values
			if (value === null || value === undefined) {
				return '';
			}

			const lowerName = name.toLowerCase();
			if (this.specialAttributeHandlers.has(lowerName)) {
				this.specialAttributeHandlers.get(lowerName)(element, value);
				return;
			}
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
				const result = fn.call(context);
				// Return result directly - let caller handle promises
				return result;
			} catch (error) {
				console.warn('StringRenderer: Function evaluation error:', error);
				console.warn('Context available:', context ? Object.keys(context) : 'No context');
				return '';
			}
		}

		// NEW: Async function evaluation
		async _evaluateFunctionAsync(fn, context) {
			if (typeof fn !== 'function') {
				return fn;
			}

			try {
				const result = await fn.call(context);
				return result;
			} catch (error) {
				console.warn('StringRenderer: Async function evaluation error:', error);
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
					const result = this._evaluateFunction(style, context);

					// If function returned a promise, return it
					if (result && typeof result.then === 'function') {
						return result.then(resolvedStyle => this._processStyleObject(resolvedStyle, context));
					}

					return this._processStyleObject(result, context);
				} catch (e) {
					console.warn('StringRenderer: Style function evaluation error:', e);
					return '';
				}
			}

			return this._processStyleObject(style, context);
		}

		// Helper to process style object into CSS string
		_processStyleObject(style, context) {
			if (typeof style === 'object' && style !== null) {
				const stylePromises = [];
				const syncRules = [];

				Object.entries(style).forEach(([prop, value]) => {
					let cssValue = value;

					if (typeof value === 'function') {
						cssValue = this._evaluateFunction(value, context);
					}

					// If we got a promise, collect it
					if (cssValue && typeof cssValue.then === 'function') {
						stylePromises.push(
							cssValue.then(resolvedValue => {
								if (resolvedValue === undefined || resolvedValue === null) return '';
								const cssProp = this._camelToKebab(prop);
								return `${cssProp}: ${resolvedValue}`;
							})
						);
					} else {
						// Skip undefined/null values
						if (cssValue === undefined || cssValue === null) return;

						const cssProp = this._camelToKebab(prop);
						syncRules.push(`${cssProp}: ${cssValue}`);
					}
				});

				// If we have async style properties, wait for them
				if (stylePromises.length > 0) {
					return Promise.all(stylePromises).then(asyncRules => {
						const allRules = [...syncRules, ...asyncRules.filter(rule => rule)];
						return allRules.join('; ');
					});
				}

				return syncRules.join('; ');
			}

			return String(style);
		}

		// NEW: Async style rendering
		async _renderStyleAsync(style, context) {
			if (!style) {
				return '';
			}

			if (typeof style === 'function') {
				try {
					style = await this._evaluateFunctionAsync(style, context);
				} catch (e) {
					console.warn('StringRenderer: Async style function evaluation error:', e);
					return '';
				}
			}

			if (typeof style === 'object' && style !== null) {
				const entries = await Promise.all(
					Object.entries(style).map(async ([prop, value]) => {
						let cssValue = value;
						if (typeof value === 'function') {
							cssValue = await this._evaluateFunctionAsync(value, context);
						}

						// Skip undefined/null values
						if (cssValue === undefined || cssValue === null) {
							return '';
						}

						const cssProp = this._camelToKebab(prop);
						return `${cssProp}: ${cssValue}`;
					})
				);

				return entries
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

		// ENHANCED: Main renderToString method with smart async detection
		renderToString(layout, context = null, options = {}) {
			if (!layout) {
				return '<p>No layout provided</p>';
			}

			const { async: forceAsync = false, timeout = this.asyncTimeout } = options;

			try {
				// If async is forced, use async rendering directly
				if (forceAsync) {
					return Promise.race([
						this.renderAsync(layout, context),
						new Promise((_, reject) =>
							setTimeout(() => reject(new Error('Async render timeout')), timeout)
						)
					]).catch(error => {
						console.error('StringRenderer forced async renderToString error:', error);
						return `<div style="color: red;">Async StringRenderer Error: ${error.message}</div>`;
					});
				}

				// Use smart rendering with auto-detection
				const result = this.render(layout, context);

				// If render returns a promise (async was detected), handle it
				if (result && typeof result.then === 'function') {
					return result.catch(error => {
						console.error('StringRenderer smart render error:', error);
						return `<div style="color: red;">Smart Render Error: ${error.message}</div>`;
					});
				}

				return result;
			} catch (error) {
				console.error('StringRenderer renderToString error:', error);
				return `<div style="color: red;">StringRenderer Error: ${error.message}</div>`;
			}
		}

		// Interface compatibility methods
		cleanup() {
			this.renderDepth = 0;
			this.asyncDetected = false;
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

	// Create instance of StringRenderer with juris reference
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

			// ENHANCED: Smart renderToString that auto-detects async
			renderToString(layout, options = {}) {
				const layoutToRender = layout || juris.layout;
				if (!layoutToRender) {
					return '<p>No layout provided</p>';
				}

				try {
					const result = stringRenderer.renderToString(layoutToRender, null, options);

					// If result is a promise, return it (caller can await)
					if (result && typeof result.then === 'function') {
						return result;
					}

					return result;
				} catch (error) {
					console.error('API renderToString error:', error);
					return `<div style="color: red;">Render Error: ${error.message}</div>`;
				}
			},

			// NEW: Explicit async method
			async renderToStringAsync(layout, options = {}) {
				const result = this.renderToString(layout, { ...options, async: true });
				return await result;
			},

			stringRenderer,
			originalDOMRenderer
		}
	};
};