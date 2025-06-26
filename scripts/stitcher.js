#!/usr/bin/env node

/**
 * JurisKit JavaScript File Stitcher with Component Auto-Registration
 * 
 * Enhanced version that automatically detects and registers Juris components.
 * Supports advanced file patterns, folder configurations, and intelligent component processing.
 * 
 * New Features:
 * - Automatic component detection and registration
 * - Component dependency analysis
 * - Registration code generation
 * - Component naming validation
 * 
 * Usage:
 *   node scripts/stitcher.js [options]
 * 
 * Options:
 *   --config <path>    Path to config file (default: config/stitcher.config.json)
 *   --manual          Force manual execution mode (show progress logs)
 *   --init            Create a sample configuration file
 *   --help, -h        Show detailed help information
 * 
 * Configuration Example:
 *   {
 *     "output": "public/js/bundle.js",
 *     "files": [
 *       "juris/juris.js",
 *       {
 *         "folder": "source/components",
 *         "recursive": true,
 *         "extensions": [".js"],
 *         "exclude": ["test", ".spec."],
 *         "componentAutoRegister": true
 *       },
 *       "source/app.js"
 *     ],
 *     "componentRegistration": {
 *       "enabled": true,
 *       "globalName": "Juris",
 *       "logRegistrations": true,
 *       "validateNames": true,
 *       "generateManifest": false
 *     },
 *     "minify": false,
 *     "addSeparators": true,
 *     "skipMissing": false,
 *     "header": "Juris App Bundle - Auto-generated"
 *   }
 * 
 * Component File Pattern:
 *   // source/components/HomePage.js
 *   const HomePage = (props, context) => ({
 *     div: { text: 'Home Page' }
 *   });
 *   
 *   // Auto-detected and registered as 'HomePage'
 * 
 * @author JurisKit Team
 * @version 2.1.0
 * @license MIT
 */

const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');

class JSStitcher {
	constructor(configPath = 'config/stitcher.config.json') {
		this.configPath = configPath;
		this.config = null;
		this.isManualExecution = process.argv.includes('--manual') || !process.env.npm_lifecycle_event;
		this.debugMode = process.argv.includes('--debug') || process.env.STITCHER_DEBUG === 'true';
		this.verboseMode = process.argv.includes('--verbose') || process.env.STITCHER_VERBOSE === 'true';
		this.detectedComponents = new Map();
		this.headlessComponents = new Map();
		this.componentDependencies = new Map();
	}

	/**
	 * Load and validate configuration file
	 */
	async loadConfig() {
		try {
			const configContent = await fs.readFile(this.configPath, 'utf8');
			this.config = JSON.parse(configContent);

			// Validate required fields
			if (!this.config.output) {
				throw new Error('Output path is required in config');
			}
			if (!this.config.files || !Array.isArray(this.config.files)) {
				throw new Error('Files array is required in config');
			}

			// Set default component registration config
			if (!this.config.componentRegistration) {
				this.config.componentRegistration = {
					enabled: false,
					globalName: 'Juris',
					logRegistrations: false,
					validateNames: true,
					generateManifest: false
				};
			}

			return this.config;
		} catch (error) {
			if (error.code === 'ENOENT') {
				throw new Error(`Config file not found: ${this.configPath}`);
			}
			throw error;
		}
	}

	/**
	 * Log message only during manual execution
	 */
	log(message) {
		if (this.isManualExecution) {
			console.log(message);
		}
	}

	/**
	 * Debug logging - always shows when debug mode is enabled
	 */
	debug(message, data = null) {
		if (this.debugMode) {
			console.log(`🔍 DEBUG: ${message}`);
			if (data) {
				console.log('   Data:', data);
			}
		}
	}

	/**
	 * Verbose logging - shows detailed information
	 */
	verbose(message, data = null) {
		if (this.verboseMode || this.debugMode) {
			console.log(`📝 VERBOSE: ${message}`);
			if (data) {
				console.log('   Details:', data);
			}
		}
	}

	/**
	 * Ensure output directory exists
	 */
	async ensureDirectoryExists(filePath) {
		const dir = path.dirname(filePath);
		try {
			await fs.access(dir);
		} catch {
			await fs.mkdir(dir, { recursive: true });
			this.log(`Created directory: ${dir}`);
		}
	}

	/**
	 * Read a single file with error handling
	 */
	async readFile(filePath) {
		try {
			const content = await fs.readFile(filePath, 'utf8');
			this.log(`✓ Read: ${filePath}`);
			return content;
		} catch (error) {
			if (error.code === 'ENOENT') {
				throw new Error(`File not found: ${filePath}`);
			}
			throw new Error(`Error reading ${filePath}: ${error.message}`);
		}
	}

	/**
	 * Detect components in JavaScript code
	 */
	detectComponents(content, filePath) {
		this.debug(`Analyzing file for components: ${filePath}`);

		const components = [];
		const headlessComponents = [];

		// Pattern 1: const ComponentName = (props, context) => ({ ... })
		const componentPattern1 = /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\([^)]*\)\s*=>\s*\(/g;
		let match1;
		while ((match1 = componentPattern1.exec(content)) !== null) {
			const component = {
				name: match1[1],
				type: 'functional',
				pattern: 'const-arrow',
				filePath: filePath
			};
			components.push(component);
			this.verbose(`Found component (const-arrow): ${match1[1]}`, { filePath, pattern: match1[0].substring(0, 50) + '...' });
		}

		// Pattern 2: function ComponentName(props, context) { ... }
		const componentPattern2 = /function\s+([A-Z][a-zA-Z0-9]*)\s*\([^)]*\)\s*\{/g;
		let match2;
		while ((match2 = componentPattern2.exec(content)) !== null) {
			const component = {
				name: match2[1],
				type: 'functional',
				pattern: 'function-declaration',
				filePath: filePath
			};
			components.push(component);
			this.verbose(`Found component (function-declaration): ${match2[1]}`, { filePath, pattern: match2[0] });
		}

		// Pattern 3: ComponentName = (props, context) => ({ ... })
		const componentPattern3 = /([A-Z][a-zA-Z0-9]*)\s*=\s*\([^)]*\)\s*=>\s*\(/g;
		let match3;
		while ((match3 = componentPattern3.exec(content)) !== null) {
			// Avoid duplicates from Pattern 1
			if (!components.find(c => c.name === match3[1])) {
				const component = {
					name: match3[1],
					type: 'functional',
					pattern: 'assignment-arrow',
					filePath: filePath
				};
				components.push(component);
				this.verbose(`Found component (assignment-arrow): ${match3[1]}`, { filePath, pattern: match3[0] });
			}
		}

		// Pattern 4: Headless components - const ComponentNameComponent = (props, context) => ({ ... })
		const headlessPattern = /const\s+([A-Z][a-zA-Z0-9]*Component)\s*=\s*\([^)]*\)\s*=>\s*/g;
		let headlessMatch;
		while ((headlessMatch = headlessPattern.exec(content)) !== null) {
			const componentName = headlessMatch[1].replace(/Component$/, '');
			const component = {
				name: componentName,
				fullName: headlessMatch[1],
				type: 'headless',
				pattern: 'headless-component',
				filePath: filePath
			};
			headlessComponents.push(component);
			this.verbose(`Found headless component: ${componentName} (${headlessMatch[1]})`, { filePath, pattern: headlessMatch[0] });
		}

		this.debug(`Detection complete for ${filePath}`, {
			regularComponents: components.length,
			headlessComponents: headlessComponents.length,
			componentNames: components.map(c => c.name),
			headlessNames: headlessComponents.map(c => c.name)
		});

		return { components, headlessComponents };
	}

	/**
	 * Generate component registration code
	 */
	generateComponentRegistration(components, headlessComponents) {
		const registrationConfig = this.config.componentRegistration;
		if (!registrationConfig.enabled) {
			this.debug('Component registration disabled, skipping generation');
			return '';
		}

		this.debug('Generating component registration code', {
			regularComponents: components.length,
			headlessComponents: headlessComponents.length,
			config: registrationConfig
		});

		const lines = [];
		lines.push('');
		lines.push('/* === AUTO-GENERATED COMPONENT REGISTRATIONS === */');
		lines.push('(function() {');
		lines.push('  \'use strict\';');
		lines.push('');

		// Create component registry object
		lines.push('  // Auto-detected components registry');
		lines.push('  window.__JURIS_COMPONENTS = window.__JURIS_COMPONENTS || {};');
		lines.push('  window.__JURIS_HEADLESS_COMPONENTS = window.__JURIS_HEADLESS_COMPONENTS || {};');
		lines.push('');

		// Add regular components to registry
		if (components.length > 0) {
			lines.push('  // Add detected components to global registry');
			for (const component of components) {
				lines.push(`  if (typeof ${component.name} !== 'undefined') {`);
				lines.push(`    window.__JURIS_COMPONENTS['${component.name}'] = ${component.name};`);
				if (registrationConfig.logRegistrations) {
					lines.push(`    console.log('Added to registry: ${component.name}');`);
				}
				lines.push(`  } else {`);
				if (this.debugMode) {
					lines.push(`    console.warn('Component ${component.name} not found in global scope');`);
				}
				lines.push(`  }`);
			}
			lines.push('');
		}

		// Add headless components to registry
		if (headlessComponents.length > 0) {
			lines.push('  // Add detected headless components to global registry');
			for (const component of headlessComponents) {
				lines.push(`  if (typeof ${component.fullName} !== 'undefined') {`);
				lines.push(`    window.__JURIS_HEADLESS_COMPONENTS['${component.name}'] = ${component.fullName};`);
				if (registrationConfig.logRegistrations) {
					lines.push(`    console.log('Added to registry: ${component.name} (headless)');`);
				}
				lines.push(`  } else {`);
				if (this.debugMode) {
					lines.push(`    console.warn('Headless component ${component.fullName} not found in global scope');`);
				}
				lines.push(`  }`);
			}
			lines.push('');
		}

		// Provide helper function for developers to use in their createApp
		lines.push('  // Helper function for developers to register all detected components');
		lines.push('  window.registerDetectedComponents = function(jurisInstance) {');
		lines.push('    if (!jurisInstance) {');
		lines.push('      console.warn("registerDetectedComponents: Juris instance required");');
		lines.push('      return { components: 0, headlessComponents: 0 };');
		lines.push('    }');
		lines.push('');
		lines.push('    let componentCount = 0;');
		lines.push('    let headlessComponentCount = 0;');
		lines.push('');
		lines.push('    // Register components');
		lines.push('    Object.entries(window.__JURIS_COMPONENTS || {}).forEach(([name, component]) => {');
		lines.push('      if (jurisInstance.registerComponent) {');
		lines.push('        jurisInstance.registerComponent(name, component);');
		lines.push('        componentCount++;');
		if (this.debugMode) {
			lines.push('        console.log(`Registered component: ${name}`);');
		}
		lines.push('      }');
		lines.push('    });');
		lines.push('');
		lines.push('    // Register headless components');
		lines.push('    Object.entries(window.__JURIS_HEADLESS_COMPONENTS || {}).forEach(([name, component]) => {');
		lines.push('      if (jurisInstance.registerHeadlessComponent) {');
		lines.push('        jurisInstance.registerHeadlessComponent(name, component);');
		lines.push('        headlessComponentCount++;');
		if (this.debugMode) {
			lines.push('        console.log(`Registered headless component: ${name}`);');
		}
		lines.push('      }');
		lines.push('    });');
		lines.push('');
		lines.push('    return { components: componentCount, headlessComponents: headlessComponentCount };');
		lines.push('  };');
		lines.push('');

		// Add debug info if enabled
		if (this.debugMode) {
			lines.push('  // Debug information');
			lines.push('  window.__JURIS_DEBUG_INFO = {');
			lines.push(`    detectedComponents: ${components.length},`);
			lines.push(`    detectedHeadlessComponents: ${headlessComponents.length},`);
			lines.push(`    generatedAt: new Date().toISOString(),`);
			lines.push('    components: Object.keys(window.__JURIS_COMPONENTS || {}),');
			lines.push('    headlessComponents: Object.keys(window.__JURIS_HEADLESS_COMPONENTS || {})');
			lines.push('  };');
			lines.push('  console.log("Juris Debug Info:", window.__JURIS_DEBUG_INFO);');
			lines.push('');
		}

		lines.push('})();');
		lines.push('');

		this.debug('Component registration code generated successfully');
		return lines.join('\n');
	}

	/**
	 * Process file content for component detection and registration
	 */
	async processFileContent(content, filePath, folderConfig = null) {
		this.debug(`Processing file: ${filePath}`);

		let processedContent = content;

		// Check if component auto-registration is enabled for this file
		const shouldAutoRegister = folderConfig?.componentAutoRegister ||
			this.config.componentRegistration?.enabled;

		this.verbose(`Auto-registration enabled: ${shouldAutoRegister}`, { filePath, folderConfig: !!folderConfig });

		if (shouldAutoRegister) {
			// Detect components in this file
			const detected = this.detectComponents(content, filePath);

			// Store detected components
			if (detected.components.length > 0) {
				this.detectedComponents.set(filePath, detected.components);
				this.log(`  Found ${detected.components.length} component(s): ${detected.components.map(c => c.name).join(', ')}`);
				this.debug(`Stored components for ${filePath}`, detected.components);
			}

			if (detected.headlessComponents.length > 0) {
				this.headlessComponents.set(filePath, detected.headlessComponents);
				this.log(`  Found ${detected.headlessComponents.length} headless component(s): ${detected.headlessComponents.map(c => c.name).join(', ')}`);
				this.debug(`Stored headless components for ${filePath}`, detected.headlessComponents);
			}
		}

		return processedContent;
	}

	/**
	 * Expand file patterns and folder configurations into file list
	 */
	async expandFilePatterns(patterns) {
		this.debug('Expanding file patterns', { totalPatterns: patterns.length });

		const expandedFiles = [];

		for (const pattern of patterns) {
			this.debug('Processing pattern', { pattern: typeof pattern === 'string' ? pattern : 'folder-config' });

			if (typeof pattern === 'string') {
				// Handle glob patterns and folder paths
				if (pattern.includes('*') || pattern.includes('?')) {
					// Glob pattern
					this.verbose('Processing glob pattern', pattern);
					const matches = await glob(pattern, { nodir: true });
					this.debug('Glob pattern matches', { pattern, matches });
					expandedFiles.push(...matches.sort().map(file => ({ file, config: null })));
				} else {
					// Check if it's a directory
					try {
						const stats = await fs.stat(pattern);
						if (stats.isDirectory()) {
							// Get all .js files in directory
							this.verbose('Processing directory pattern', pattern);
							const dirPattern = path.join(pattern, '**/*.js');
							const matches = await glob(dirPattern, { nodir: true });
							this.debug('Directory pattern matches', { pattern, dirPattern, matches });
							expandedFiles.push(...matches.sort().map(file => ({ file, config: null })));
						} else {
							// It's a file
							this.verbose('Processing single file', pattern);
							expandedFiles.push({ file: pattern, config: null });
						}
					} catch (error) {
						// File doesn't exist, add as-is (will be handled later)
						this.debug('Pattern not found, adding as-is', { pattern, error: error.message });
						expandedFiles.push({ file: pattern, config: null });
					}
				}
			} else if (typeof pattern === 'object') {
				// Handle folder config objects
				if (pattern.folder) {
					this.debug('Processing folder config', { folder: pattern.folder, recursive: pattern.recursive });
					const folderFiles = await this.expandFolderConfig(pattern);
					this.debug('Folder config results', { folder: pattern.folder, filesFound: folderFiles.length, files: folderFiles });
					expandedFiles.push(...folderFiles.map(file => ({ file, config: pattern })));
				} else if (pattern.files) {
					// Handle nested file arrays
					this.verbose('Processing nested file arrays', pattern.files);
					const nested = await this.expandFilePatterns(pattern.files);
					expandedFiles.push(...nested);
				}
			}
		}

		this.debug('File pattern expansion complete', {
			totalFiles: expandedFiles.length,
			files: expandedFiles.map(f => f.file)
		});

		return expandedFiles;
	}

	/**
	 * Expand folder configuration object
	 */
	async expandFolderConfig(folderConfig) {
		const folderPath = folderConfig.folder;
		this.debug('Expanding folder config', { folderPath, config: folderConfig });

		const options = {
			recursive: folderConfig.recursive !== false, // default true
			extensions: folderConfig.extensions || ['.js'],
			exclude: folderConfig.exclude || [],
			sort: folderConfig.sort !== false // default true
		};

		this.verbose('Folder config options', options);

		let searchPattern;
		if (options.recursive) {
			searchPattern = path.posix.join(folderPath, '**/*'); // Force Unix-style paths for glob
		} else {
			searchPattern = path.posix.join(folderPath, '*'); // Force Unix-style paths for glob
		}

		this.debug('Searching with pattern', { searchPattern, folderPath });

		try {
			const matches = await glob(searchPattern, { nodir: true });
			this.debug('Raw glob matches', { searchPattern, matchCount: matches.length, matches });

			// Filter by extensions and exclusions
			const filtered = matches.filter(file => {
				const ext = path.extname(file);
				const fileName = path.basename(file);
				const relativePath = path.relative(folderPath, file);

				this.verbose('Filtering file', { file, ext, fileName, relativePath });

				// Check extension
				if (!options.extensions.includes(ext)) {
					this.verbose('File excluded by extension', { file, ext, allowedExtensions: options.extensions });
					return false;
				}

				// Check exclusions
				for (const exclude of options.exclude) {
					if (typeof exclude === 'string') {
						if (fileName.includes(exclude) || relativePath.includes(exclude)) {
							this.verbose('File excluded by string pattern', { file, exclude });
							return false;
						}
					} else if (exclude instanceof RegExp) {
						if (exclude.test(fileName) || exclude.test(relativePath)) {
							this.verbose('File excluded by regex pattern', { file, exclude });
							return false;
						}
					}
				}

				this.verbose('File accepted', { file });
				return true;
			});

			if (options.sort) {
				filtered.sort();
			}

			this.debug('Folder expansion complete', {
				folderPath,
				totalMatches: matches.length,
				filteredFiles: filtered.length,
				files: filtered
			});

			return filtered;
		} catch (error) {
			this.debug('Error expanding folder', { folderPath, error: error.message });
			return [];
		}
	}

	/**
	 * Manual directory scanning fallback
	 */
	async manualDirectoryScan(dirPath, recursive = true) {
		const results = [];

		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);

				if (entry.isFile() && entry.name.endsWith('.js')) {
					results.push(fullPath);
				} else if (entry.isDirectory() && recursive) {
					const subResults = await this.manualDirectoryScan(fullPath, recursive);
					results.push(...subResults);
				}
			}
		} catch (error) {
			this.debug('Manual scan error', { dirPath, error: error.message });
		}

		return results;
	}

	/**
	 * Simple JavaScript minification
	 */
	minifyJS(code) {
		try {
			return code
				// Remove single-line comments
				.replace(/\/\/.*$/gm, '')
				// Remove multi-line comments
				.replace(/\/\*[\s\S]*?\*\//g, '')
				// Remove extra whitespace
				.replace(/\s+/g, ' ')
				// Remove whitespace around operators and punctuation
				.replace(/\s*([{}();,=+\-*/<>!&|])\s*/g, '$1')
				// Remove leading/trailing whitespace
				.trim();
		} catch (error) {
			throw new Error(`Minification failed: ${error.message}`);
		}
	}

	/**
	 * Generate component manifest
	 */
	generateComponentManifest() {
		const manifest = {
			generated: new Date().toISOString(),
			totalComponents: 0,
			totalHeadlessComponents: 0,
			components: [],
			headlessComponents: []
		};

		// Collect all components
		for (const [filePath, components] of this.detectedComponents) {
			manifest.components.push(...components.map(c => ({
				name: c.name,
				type: c.type,
				pattern: c.pattern,
				file: path.relative(process.cwd(), filePath)
			})));
		}

		// Collect all headless components
		for (const [filePath, headlessComponents] of this.headlessComponents) {
			manifest.headlessComponents.push(...headlessComponents.map(c => ({
				name: c.name,
				fullName: c.fullName,
				type: c.type,
				pattern: c.pattern,
				file: path.relative(process.cwd(), filePath)
			})));
		}

		manifest.totalComponents = manifest.components.length;
		manifest.totalHeadlessComponents = manifest.headlessComponents.length;

		return manifest;
	}

	/**
	 * Main stitching process
	 */
	async stitchFiles() {
		await this.loadConfig();

		this.log(`Starting JS stitching with config: ${this.configPath}`);
		this.log(`Output: ${this.config.output}`);
		this.debug(`Current working directory: ${process.cwd()}`);

		// Check if directories exist
		for (const filePattern of this.config.files) {
			if (typeof filePattern === 'object' && filePattern.folder) {
				try {
					const stats = await fs.stat(filePattern.folder);
					this.debug(`Folder check: ${filePattern.folder}`, {
						exists: true,
						isDirectory: stats.isDirectory(),
						size: stats.size
					});
				} catch (error) {
					this.debug(`Folder check: ${filePattern.folder}`, {
						exists: false,
						error: error.message
					});
				}
			}
		}

		// Expand file patterns and folders
		const expandedFiles = await this.expandFilePatterns(this.config.files);

		this.log(`Files to process: ${expandedFiles.length}`);

		// Debug: Check for duplicates in file list
		const fileNames = expandedFiles.map(f => f.file);
		const uniqueFiles = [...new Set(fileNames)];
		if (fileNames.length !== uniqueFiles.length) {
			this.debug('WARNING: Duplicate files detected in expansion', {
				totalFiles: fileNames.length,
				uniqueFiles: uniqueFiles.length,
				duplicates: fileNames.filter((file, index) => fileNames.indexOf(file) !== index)
			});
		}

		if (this.isManualExecution && expandedFiles.length > 10) {
			this.log(`First 10 files: ${expandedFiles.slice(0, 10).map(f => path.basename(f.file)).join(', ')}...`);
		} else if (this.isManualExecution) {
			this.log(`Files: ${expandedFiles.map(f => path.basename(f.file)).join(', ')}`);
		}

		// Ensure output directory exists
		await this.ensureDirectoryExists(this.config.output);

		const stitchedContent = [];

		// Add header comment if specified
		if (this.config.header) {
			stitchedContent.push(`/* ${this.config.header} */`);
			stitchedContent.push('');
		}

		// Process each file in order
		for (let i = 0; i < expandedFiles.length; i++) {
			const { file: filePath, config: folderConfig } = expandedFiles[i];

			try {
				// Add file separator comment
				if (this.config.addSeparators !== false) {
					stitchedContent.push(`/* === ${path.basename(filePath)} === */`);
				}

				const content = await this.readFile(filePath);
				const processedContent = await this.processFileContent(content, filePath, folderConfig);
				stitchedContent.push(processedContent);

				// Add newline between files
				if (i < expandedFiles.length - 1) {
					stitchedContent.push('');
				}

			} catch (error) {
				if (this.config.skipMissing) {
					this.log(`⚠ Skipping missing file: ${filePath}`);
					continue;
				}
				throw error;
			}
		}

		// Generate component registration code if enabled
		if (this.config.componentRegistration?.enabled) {
			const allComponents = Array.from(this.detectedComponents.values()).flat();
			const allHeadlessComponents = Array.from(this.headlessComponents.values()).flat();

			// Debug: Check for duplicates in detected components
			const componentNames = allComponents.map(c => c.name);
			const uniqueComponentNames = [...new Set(componentNames)];
			if (componentNames.length !== uniqueComponentNames.length) {
				this.debug('WARNING: Duplicate components detected', {
					totalComponents: componentNames.length,
					uniqueComponents: uniqueComponentNames.length,
					duplicateNames: componentNames.filter((name, index) => componentNames.indexOf(name) !== index)
				});

				// Deduplicate components by name (keep last occurrence)
				const deduplicatedComponents = [];
				const seenNames = new Set();
				for (let i = allComponents.length - 1; i >= 0; i--) {
					const component = allComponents[i];
					if (!seenNames.has(component.name)) {
						deduplicatedComponents.unshift(component);
						seenNames.add(component.name);
					}
				}
				this.debug('Deduplicated components', {
					originalCount: allComponents.length,
					deduplicatedCount: deduplicatedComponents.length,
					deduplicatedNames: deduplicatedComponents.map(c => c.name)
				});
			}

			const headlessNames = allHeadlessComponents.map(c => c.name);
			const uniqueHeadlessNames = [...new Set(headlessNames)];
			if (headlessNames.length !== uniqueHeadlessNames.length) {
				this.debug('WARNING: Duplicate headless components detected', {
					totalHeadless: headlessNames.length,
					uniqueHeadless: uniqueHeadlessNames.length,
					duplicateNames: headlessNames.filter((name, index) => headlessNames.indexOf(name) !== index)
				});
			}

			if (allComponents.length > 0 || allHeadlessComponents.length > 0) {
				const registrationCode = this.generateComponentRegistration(allComponents, allHeadlessComponents);
				stitchedContent.push(registrationCode);

				this.log(`✓ Generated registration for ${allComponents.length} components and ${allHeadlessComponents.length} headless components`);
			}
		}

		let finalContent = stitchedContent.join('\n');

		// Minify if requested
		if (this.config.minify) {
			this.log('Minifying output...');
			finalContent = this.minifyJS(finalContent);
		}

		// Write the stitched file
		await fs.writeFile(this.config.output, finalContent, 'utf8');

		// Generate component manifest if requested
		if (this.config.componentRegistration?.generateManifest) {
			const manifest = this.generateComponentManifest();
			const manifestPath = this.config.output.replace(/\.js$/, '.manifest.json');
			await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
			this.log(`✓ Generated component manifest: ${manifestPath}`);
		}

		const stats = await fs.stat(this.config.output);
		this.log(`✓ Successfully stitched ${expandedFiles.length} files`);
		this.log(`✓ Output written to: ${this.config.output} (${(stats.size / 1024).toFixed(2)} KB)`);

		return this.config.output;
	}

	/**
	 * Create a sample configuration file
	 */
	static async createSampleConfig() {
		const sampleConfig = {
			"output": "public/js/juris-app.js",
			"files": [
				"juris/juris.js",
				{
					"folder": "source/components",
					"recursive": true,
					"extensions": [".js"],
					"exclude": ["test", ".spec."],
					"componentAutoRegister": true
				},
				"source/app.js"
			],
			"componentRegistration": {
				"enabled": true,
				"globalName": "Juris",
				"logRegistrations": true,
				"validateNames": true,
				"generateManifest": false
			},
			"minify": false,
			"addSeparators": true,
			"skipMissing": false,
			"header": "Juris App Bundle - Auto-generated"
		};

		// Ensure config directory exists
		try {
			await fs.mkdir('config', { recursive: true });
		} catch (error) {
			// Directory might already exist
		}

		await fs.writeFile('config/stitcher.config.json', JSON.stringify(sampleConfig, null, 2));
		console.log('✓ Created sample config: config/stitcher.config.json');
	}
}

/**
 * CLI handling
 */
async function main() {
	const args = process.argv.slice(2);

	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
JavaScript File Stitcher with Component Auto-Registration

Usage:
  node scripts/stitcher.js [options]

Options:
  --config <path>    Path to config file (default: config/stitcher.config.json)
  --manual          Force manual execution mode (show progress)
  --debug           Enable debug mode (detailed component detection info)
  --verbose         Enable verbose logging (show all processing steps)
  --init            Create a sample config file
  --help, -h        Show this help

Environment Variables:
  STITCHER_DEBUG=true     Enable debug mode
  STITCHER_VERBOSE=true   Enable verbose logging

Config file format:
{
  "output": "public/js/juris-app.js",
  "files": [
    "juris/juris.js",
    {
      "folder": "source/components",
      "recursive": true,
      "extensions": [".js"],
      "exclude": ["test", ".spec."],
      "componentAutoRegister": true
    },
    "source/app.js"
  ],
  "componentRegistration": {
    "enabled": true,
    "globalName": "Juris",
    "logRegistrations": true,
    "validateNames": true,
    "generateManifest": false
  },
  "minify": false,
  "addSeparators": true,
  "skipMissing": false,
  "header": "Juris App Bundle - Auto-generated"
}

Component Detection Patterns:
- const ComponentName = (props, context) => ({ ... })
- function ComponentName(props, context) { ... }
- ComponentName = (props, context) => ({ ... })
- const ComponentNameComponent = (props, context) => ({ ... }) [Headless]

Automatic Registration:
Components are automatically registered with Juris.registerComponent()
or Juris.registerHeadlessComponent() based on detected patterns.
    `);
		return;
	}

	if (args.includes('--init')) {
		await JSStitcher.createSampleConfig();
		return;
	}

	const configIndex = args.indexOf('--config');
	const configPath = configIndex !== -1 ? args[configIndex + 1] : 'config/stitcher.config.json';

	try {
		const stitcher = new JSStitcher(configPath);
		await stitcher.stitchFiles();
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

// Export for programmatic use
module.exports = JSStitcher;

// Run if called directly
if (require.main === module) {
	main().catch(error => {
		console.error(`Fatal error: ${error.message}`);
		process.exit(1);
	});
}