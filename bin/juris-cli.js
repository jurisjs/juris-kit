#!/usr/bin/env node

// bin/juris.js - Juris CLI tool

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { version } = require('../package.json');

// Commands
program
	.name('juris')
	.description('Juris Kit - SSR Framework CLI')
	.version(version);

// Start command
program
	.command('start')
	.description('Start the Juris server')
	.option('-c, --config <path>', 'Path to config file', './juris.config.js')
	.option('-p, --port <number>', 'Port to run on')
	.option('-h, --host <string>', 'Host to bind to')
	.option('--production', 'Run in production mode')
	.action((options) => {
		if (options.production) {
			process.env.NODE_ENV = 'production';
		}

		if (options.port) {
			process.env.PORT = options.port;
		}

		if (options.host) {
			process.env.HOST = options.host;
		}

		const serverPath = path.join(process.cwd(), 'server.js');
		if (!fs.existsSync(serverPath)) {
			console.error('Error: server.js not found in current directory');
			console.log('Run "juris init" to create a new project');
			process.exit(1);
		}

		console.log('Starting Juris server...');
		require(serverPath);
	});

// Dev command
program
	.command('dev')
	.description('Start the development server with hot reload')
	.option('-c, --config <path>', 'Path to config file', './juris.config.js')
	.action((options) => {
		process.env.NODE_ENV = 'development';

		const serverPath = path.join(process.cwd(), 'server.js');
		if (!fs.existsSync(serverPath)) {
			console.error('Error: server.js not found in current directory');
			console.log('Run "juris init" to create a new project');
			process.exit(1);
		}

		console.log('Starting Juris development server...');
		const child = spawn('npm', ['run', 'dev'], {
			stdio: 'inherit',
			shell: true,
			cwd: process.cwd()
		});

		child.on('exit', (code) => {
			process.exit(code);
		});
	});

// Build command
program
	.command('build')
	.description('Build the application')
	.option('--minify', 'Minify the output')
	.option('--watch', 'Watch for changes')
	.action((options) => {
		console.log('Building Juris application...');

		const buildScript = path.join(process.cwd(), 'scripts/stitcher.js');
		if (!fs.existsSync(buildScript)) {
			console.error('Error: Build script not found');
			process.exit(1);
		}

		const args = ['scripts/stitcher.js'];
		if (options.minify) {
			args.push('--config', 'config/stitch.min.config.json');
		}

		const child = spawn('node', args, {
			stdio: 'inherit',
			cwd: process.cwd()
		});

		child.on('exit', (code) => {
			if (code === 0) {
				console.log('✓ Build completed successfully');
			}
			process.exit(code);
		});
	});

// Init command
program
	.command('init [project-name]')
	.description('Create a new Juris project')
	.option('-t, --template <name>', 'Use a specific template', 'default')
	.action((projectName, options) => {
		const targetDir = projectName || '.';
		console.log(`Creating new Juris project in ${targetDir}...`);

		// Create project structure
		const dirs = [
			'juris',
			'source/components',
			'source/layouts',
			'source/pages',
			'source/utilities',
			'public/css',
			'public/js',
			'scripts',
			'config',
			'docs'
		];

		const baseDir = path.join(process.cwd(), targetDir);

		if (projectName && !fs.existsSync(baseDir)) {
			fs.mkdirSync(baseDir, { recursive: true });
		}

		dirs.forEach(dir => {
			const fullPath = path.join(baseDir, dir);
			if (!fs.existsSync(fullPath)) {
				fs.mkdirSync(fullPath, { recursive: true });
			}
		});

		// Copy template files
		const templateDir = path.join(__dirname, '..', 'templates', options.template);

		// Create basic files if template doesn't exist
		const serverContent = `// server.js - Simple entry point for Juris Server
const JurisServer = require('./juris/server.js');

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

module.exports = server;`;

		fs.writeFileSync(path.join(baseDir, 'server.js'), serverContent);

		// Create default config
		const configContent = `module.exports = {
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

		fs.writeFileSync(path.join(baseDir, 'juris.config.js'), configContent);

		// Create .gitignore
		const gitignoreContent = `node_modules/
dist/
logs/
coverage/
.env
.DS_Store
*.log
npm-debug.log*
.npm
.eslintcache`;

		fs.writeFileSync(path.join(baseDir, '.gitignore'), gitignoreContent);

		console.log('✓ Project structure created');
		console.log('\nNext steps:');
		if (projectName) {
			console.log(`  cd ${projectName}`);
		}
		console.log('  npm install');
		console.log('  npm run dev');
	});

// Config command
program
	.command('config')
	.description('Show current configuration')
	.option('--json', 'Output as JSON')
	.action((options) => {
		const configPath = path.join(process.cwd(), 'juris.config.js');

		if (!fs.existsSync(configPath)) {
			console.error('No juris.config.js found in current directory');
			process.exit(1);
		}

		const config = require(configPath);

		if (options.json) {
			console.log(JSON.stringify(config, null, 2));
		} else {
			console.log('Current Juris configuration:');
			console.log('==========================');
			console.log(`Server Port: ${config.server?.port || 3000}`);
			console.log(`Server Host: ${config.server?.host || '0.0.0.0'}`);
			console.log(`App Title: ${config.app?.title || 'Juris App'}`);
			console.log(`SSR Enabled: ${config.features?.ssr !== false}`);
			console.log(`Compression: ${config.features?.compression !== false}`);
		}
	});

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
	program.outputHelp();
}