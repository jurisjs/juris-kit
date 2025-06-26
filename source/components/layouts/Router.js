
const Router = (props, { headless }) => ({
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
})