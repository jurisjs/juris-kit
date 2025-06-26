// index.js - Main entry point for Juris Kit npm package

// Core exports
const JurisServer = require('./juris/juris-server.js');
const Juris = require('./juris/juris.js');

// Utilities
const createApp = require('./source/app.js').createApp;
const stitcher = require('./scripts/stitcher.js');

// Version info
const { version, name } = require('./package.json');

// Main export object
module.exports = {
	// Core classes
	JurisServer,
	Juris,

	// Factory functions
	createApp,

	// Utilities
	stitcher,

	// Quick start function
	createServer(config) {
		return new JurisServer(config);
	},

	// Version info
	version,
	name,

	// Default configuration
	defaultConfig: require('./config/juris.config.js')
};

// Also export as named exports
module.exports.JurisServer = JurisServer;
module.exports.Juris = Juris;
module.exports.createApp = createApp;
module.exports.stitcher = stitcher;

// For backwards compatibility
module.exports.default = module.exports;