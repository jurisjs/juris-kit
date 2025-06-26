# Juris App Stitching Setup Guide

## 📁 Your Project Structure
```
your-project/
├── scripts/
│   └── stitch.js             # The stitcher script (your location)
├── config/
│   └── stitch.config.json    # Juris stitching config (your location)
├── juris/
│   └── juris.js              # Your Juris framework
├── source/
│   └── app.js                # Your application code
├── public/
│   └── js/
│       └── juris-app.js      # Generated bundle (auto-created)
└── package.json
```

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
npm install glob
```

### 2. Create Configuration File
Save this as `config/stitch.config.json`:
```json
{
  "output": "public/js/juris-app.js",
  "files": [
    "juris/juris.js",
    "source/app.js"
  ],
  "minify": false,
  "addSeparators": true,
  "skipMissing": false,
  "header": "Juris App Bundle - Auto-generated from juris.js + app.js"
}
```

### 3. Update Your package.json Scripts
Replace your existing scripts section with the enhanced version that includes stitching.

## 🔧 Available Commands

### Development (with auto-rebuild)
```bash
npm run dev
# Watches juris/ and source/ folders
# Rebuilds juris-app.js on any changes
# Starts your server
```

### Manual Build
```bash
npm run build:juris
# Runs: node scripts/stitch.js --config config/stitch.config.json
```

### Watch Mode (build only)
```bash
npm run watch:juris
# Watches and rebuilds without starting server
```

### Your Original Commands (still work!)
```bash
npm run copy      # Now runs the stitcher instead of cp
npm start         # Unchanged
```

## 📦 Generated Bundle Structure

The generated `public/js/juris-app.js` will look like:
```javascript
/* Juris App Bundle - Auto-generated from juris.js + app.js */

/* === juris.js === */
// Content from juris/juris.js

/* === app.js === */
// Content from source/app.js
```

## 🎯 Command Structure

All commands now reference your specific file locations:
- **Stitcher**: `node scripts/stitch.js`
- **Config**: `--config config/stitch.config.json`
- **Other configs**: `config/stitch.min.config.json`, `config/stitch.vendor.config.json`

## 🔄 Migration from Your Current Setup

Your current `copy` script:
```bash
"copy": "cp app.js public/js/ && cp juris.js public/js/"
```

New equivalent:
```bash
"copy": "npm run build:juris"
```

Which runs:
```bash
node scripts/stitch.js --config config/stitch.config.json
```

## 🚀 Advanced Configuration Options

### Multiple Config Files in config/ Directory

**config/stitch.config.json** (Development):
```json
{
  "output": "public/js/juris-app.js",
  "files": ["juris/juris.js", "source/app.js"],
  "minify": false,
  "addSeparators": true
}
```

**config/stitch.min.config.json** (Production):
```json
{
  "output": "public/js/juris-app.min.js", 
  "files": ["juris/juris.js", "source/app.js"],
  "minify": true,
  "addSeparators": false
}
```

**config/stitch.vendor.config.json** (Vendor libraries):
```json
{
  "output": "public/js/vendor.js",
  "files": ["node_modules/lodash/lodash.min.js", "vendor/*.js"],
  "minify": false,
  "addSeparators": true
}
```

### Build Commands for Different Configs
```bash
npm run build:juris     # Uses config/stitch.config.json
npm run build:minify    # Uses config/stitch.min.config.json  
npm run build:vendor    # Uses config/stitch.vendor.config.json
npm run build:all       # Builds all configurations
```

## 🏃‍♂️ Quick Start

1. Your stitcher is already at `scripts/stitch.js` ✅
2. Create `config/stitch.config.json` with the configuration above
3. Update your package.json scripts
4. Run: `npm install glob`
5. Test: `npm run build:juris`
6. Develop: `npm run dev`

Your `public/js/juris-app.js` will be automatically created and updated whenever you change files in `juris/` or `source/`!

## 🎁 Benefits

- ✅ **Organized Structure**: Configs in `config/`, scripts in `scripts/`
- ✅ **Single File**: One `juris-app.js` instead of separate files
- ✅ **Auto-Rebuild**: Changes in either file trigger rebuild
- ✅ **Clear Boundaries**: File separators show source origins
- ✅ **Multiple Environments**: Easy dev/prod/vendor configurations