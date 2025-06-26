// build-static.js
const JurisServer = require('../server');

async function build() {
	const server = new JurisServer('./juris.static.config.js');
	await server.generateStatic();
}

build().catch(console.error);