// config/custom-endpoints.js
const customEndpoints = {
	// Custom URL patterns that don't follow REST conventions
	'/api/health': {
		method: 'GET',
		handler: async () => ({
			status: 'healthy',
			timestamp: Date.now(),
			uptime: process.uptime()
		})
	},

	'/api/version': {
		method: 'GET',
		handler: async () => ({
			version: '1.0.0',
			buildDate: '2024-01-01'
		})
	},

	'/api/search': {
		method: 'GET',
		handler: async (params) => {
			const { q, type = 'users' } = params;
			// Custom search logic across multiple resources
			return { results: [], query: q, type };
		}
	},

	'/api/upload': {
		method: 'POST',
		handler: async (body, params, request) => {
			// Custom file upload logic
			return { uploaded: true, filename: 'file.jpg' };
		}
	}
};
