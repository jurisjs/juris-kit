const AboutPage = () => ({
	div: {
		style: { padding: '20px' },
		children: () => [{
			h1: { text: 'About Us' }
		}, {
			p: { text: 'This is a sample Juris application with StringRenderer and SimpleRouter.' }
		},
		{
			div: {
				id: 'auto-content',
				text: 'Loading...',
				swap: {
					trigger: 'load',
					url: '/public/swap.html',
					target: '#auto-content'
				}
			}
		}]
	}
});