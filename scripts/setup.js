// scripts/setup.js - Initial setup script for Juris Kit

const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up Juris Kit...\n');

// Create necessary directories
const directories = [
	'logs',
	'temp',
	'dist',
	'public/css',
	'public/js',
	'source/components',
	'source/layouts',
	'source/pages',
	'source/utilities'
];

directories.forEach(dir => {
	const dirPath = path.join(process.cwd(), dir);
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
		console.log(`✓ Created directory: ${dir}`);
	}
});

// Create default config if it doesn't exist
const configPath = path.join(process.cwd(), 'juris.config.js');
if (!fs.existsSync(configPath)) {
	const defaultConfig = `module.exports = {
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0'
  },
  app: {
    title: 'My Juris App',
    initialState: {
      counter: 0,
      todos: [],
      user: { name: 'Guest', isLoggedIn: false }
    }
  }
};`;

	fs.writeFileSync(configPath, defaultConfig);
	console.log('✓ Created default juris.config.js');
}

// Create .env.example if it doesn't exist
const envExamplePath = path.join(process.cwd(), '.env.example');
if (!fs.existsSync(envExamplePath)) {
	const envExample = `# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# App Configuration
APP_TITLE="My Juris App"

# Feature Flags
ENABLE_COMPRESSION=true
ENABLE_SSR=true
`;

	fs.writeFileSync(envExamplePath, envExample);
	console.log('✓ Created .env.example');
}

console.log('\n✅ Setup completed successfully!');
console.log('\nNext steps:');
console.log('  1. Run "npm run dev" to start the development server');
console.log('  2. Open http://localhost:3000 in your browser');
console.log('  3. Start building your app!\n');