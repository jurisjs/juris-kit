// Main App Layout
const App = (props, { getState }) => ({
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
