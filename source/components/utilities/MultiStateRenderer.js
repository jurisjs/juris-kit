// ============================================
// source/components/utilities/MultiStateRenderer.js
// ============================================
const MultiStateRenderer = (props, context) => ({
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
});