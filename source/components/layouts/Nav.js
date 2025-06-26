// Navigation remains the same
const Nav = (props, { headless }) => ({
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
})