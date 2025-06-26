// server.js - Simple entry point for Juris Server
const JurisServer = require('./juris/juris-server.js');

// Create and start the server
const server = new JurisServer();

// Start the server
server.start().catch(err => {
	console.error('Failed to start server:', err);
	process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
	console.log('SIGTERM received, shutting down gracefully...');
	await server.stop();
	process.exit(0);
});

process.on('SIGINT', async () => {
	console.log('SIGINT received, shutting down gracefully...');
	await server.stop();
	process.exit(0);
});

// Export for testing or programmatic use
module.exports = server;
/**
 * Developer Notes:
 * Dont modify this file directly. Use the JurisServer class in config/juris.config.js
 */