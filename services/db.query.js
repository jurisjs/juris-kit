// location: services/db.query.js
'use strict';
// Cache for API model services
let apiServices = null;
// Load API services (server-side only)
const loadAPIServices = async () => {
	if (apiServices) return apiServices;

	try {
		// Try to load the API model file
		const path = require('path');
		const fs = require('fs');

		// Look for api.model.js in config directory
		const configPath = path.join(process.cwd(), 'config', 'api.model.js');

		if (fs.existsSync(configPath)) {
			// Clear require cache to allow hot reloading in development
			delete require.cache[require.resolve(configPath)];
			apiServices = require(configPath);
			console.log('Loaded API services from /config/api.model.js');
		} else {
			console.warn('API model file not found at /config/api.model.js');
			apiServices = {};
		}
	} catch (error) {
		console.error('Error loading API services:', error);
		apiServices = {};
	}

	return apiServices;
};

module.exports.loadAPIServices = loadAPIServices;