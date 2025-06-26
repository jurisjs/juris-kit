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