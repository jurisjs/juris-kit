const UserPage = (props, { getState, setState, headless }) => {
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
}