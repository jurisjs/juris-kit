# Juris Kit Framework

[![NPM Version](https://img.shields.io/npm/v/juris.svg)](https://www.npmjs.com/package/juris)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Performance](https://img.shields.io/badge/Performance-1300%2B%20req%2Fs-green.svg)](#performance)

> **The only Non-Blocking Reactive Framework for JavaScript**  
> Temporal Independent • Automatic Deep Call Stack Branch Aware Dependency Detection • Smart Promise Handling • Component Lazy Compilation • Non-Blocking Rendering


## 📚 Resources

- **🏠 Website**: [https://jurisjs.com/](https://jurisjs.com/)
- **📦 NPM**: [https://www.npmjs.com/package/juris](https://www.npmjs.com/package/juris)
- **🧰 GitHub Kit**: [https://github.com/jurisjs/juris-kit](https://github.com/jurisjs/juris-kit)
- **💻 GitHub Core**: [https://github.com/jurisjs/juris](https://github.com/jurisjs/juris)
- **🎨 Codepen**: [https://codepen.io/jurisauthor](https://codepen.io/jurisauthor)
- **🧪 Online Testing**: [https://jurisjs.com/tests/juris_pure_test_interface.html](https://jurisjs.com/tests/juris_pure_test_interface.html)

## ✨ Key Features

### 🔄 **Reactive State Management**
- **Temporal Independent**: State updates don't block rendering
- **Smart Dependency Detection**: Automatically tracks state dependencies
- **Deep Call Stack Awareness**: Handles complex nested reactivity

### ⚡ **Non-Blocking Architecture**
- **Async-First Design**: Native Promise support throughout
- **Lazy Component Compilation**: Components render only when needed
- **Smart Promise Handling**: Automatic async/await detection

### 🎨 **Flexible Rendering**
- **Dual Render Modes**: Fine-grained or batch rendering
- **Server-Side Rendering**: Built-in SSR with hydration
- **String Rendering**: Generate HTML strings for any use case

### 🏗️ **Component System**
- **Functional Components**: Simple function-based components
- **Lifecycle Hooks**: onMount, onUpdate, onUnmount support
- **Headless Components**: Logic-only components for state management

### 🌐 **Full-Stack Ready**
- **Built-in Server**: Fastify-based server with API routes
- **Static Generation**: Smart static site generation with reactivity detection
- **Universal API Client**: Works seamlessly on server and client

## 📖 Documentation

## 🚀 Quick Start

```bash
npm install juris
```

```javascript
import Juris from 'juris';

const app = new Juris({
  states: { counter: 0 },
  layout: {
    div: {
      text: () => `Count: ${app.getState('counter')}`,
      children: [{
        button: {
          text: 'Increment',
          onClick: () => app.setState('counter', app.getState('counter') + 1)
        }
      }]
    }
  }
});

app.render('#app');
```

### Basic State Management

```javascript
const app = new Juris({
  states: {
    user: { name: 'John', age: 30 },
    todos: []
  }
});

// Get state
const userName = app.getState('user.name');

// Set state
app.setState('user.age', 31);

// Subscribe to changes
app.subscribe('user', (newValue, oldValue) => {
  console.log('User changed:', newValue);
});
```

### Component Definition

```javascript
// Functional Component
const TodoItem = (props, context) => {
  const { getState, setState } = context;
  
  return {
    div: {
      className: () => getState('todos.completed') ? 'completed' : '',
      text: props.title,
      onClick: () => setState('todos.completed', !getState('todos.completed'))
    }
  };
};

// Register component
app.registerComponent('TodoItem', TodoItem);

// Use in layout
const layout = {
  div: {
    children: () => getState('todos').map(todo => ({
      TodoItem: { title: todo.title, id: todo.id }
    }))
  }
};
```

### Async Components

```javascript
const AsyncUserProfile = async (props, context) => {
  const userData = await fetch(`/api/users/${props.userId}`).then(r => r.json());
  
  return {
    div: {
      text: `Welcome, ${userData.name}!`,
      children: [{
        img: { src: userData.avatar, alt: userData.name }
      }]
    }
  };
};
```

### Server-Side Rendering

```javascript
// server.js
const JurisServer = require('juris/server');

const server = new JurisServer({
  server: { port: 3000 },
  app: {
    title: 'My Juris App',
    initialState: { message: 'Hello World' }
  },
  features: {
    ssr: true,
    api: true,
    compression: true
  }
});

server.start();
```

### API Integration

```javascript
// Headless API Component
const createAPI = (endpoints, context) => {
  const { getState, setState } = context;
  
  return {
    api: {
      async fetchUsers() {
        setState('users.loading', true);
        try {
          const users = await fetch('/api/users').then(r => r.json());
          setState('users.data', users);
        } finally {
          setState('users.loading', false);
        }
      }
    }
  };
};

app.registerHeadlessComponent('API', createAPI);
```

### Static Site Generation

```javascript
// juris.config.js
module.exports = {
  htmlCache: {
    generation: {
      enabled: true,
      outputDir: 'dist',
      routes: ['/', '/about', '/contact'],
      ttl: 300000, // 5 minutes
      minifyHTML: true
    }
  }
};

// Generate static files
npx juris generate
```

## 🏗️ Project Structure

```
my-juris-app/
├── config/
│   └── juris.config.js     # Server configuration
├── public/
│   ├── css/
│   │   └── styles.css      # Stylesheets
│   └── js/
│       └── juris-app.js    # Client-side app
├── source/
│   ├── components/         # Reusable components
│   ├── headless/          # Headless components
│   └── app.js             # Main application
├── services/
│   └── db.query.js        # Database services
└── package.json
```

## 🎯 Advanced Features

### Smart Attribute Swapping

```javascript
// Add swap functionality for dynamic content updates
{
  button: {
    text: 'Load More',
    swap: {
      trigger: 'click',
      url: '/api/more-content',
      target: '#content-area'
    }
  }
}
```

### DOM Enhancement

```javascript
// Enhance existing HTML elements
app.enhance('.dropdown', {
  onClick: (e) => {
    e.target.classList.toggle('open');
  },
  style: {
    cursor: 'pointer'
  }
});
```

### Local Component State

```javascript
const Counter = (props, context) => {
  const [count, setCount] = context.newState('count', 0);
  
  return {
    div: {
      text: () => `Count: ${count()}`,
      children: [{
        button: {
          text: 'Increment',
          onClick: () => setCount(count() + 1)
        }
      }]
    }
  };
};
```

## 🚀 Performance

Juris delivers exceptional performance in production environments:

```
Artillery Load Test Results:
├── Requests per second: 1,332 req/s
├── Average response time: 9.6ms
├── 95th percentile: 15ms
├── 99th percentile: 19.1ms
└── Zero failed requests (50,000 total)
```

### Performance Features
- **Non-blocking reactivity**: UI stays responsive during state updates
- **Smart caching**: Automatic caching of async operations
- **Efficient reconciliation**: Minimal DOM updates
- **Bundle size optimization**: Tree-shaking and code splitting ready

## 🔧 Configuration

### Complete Configuration Example

```javascript
// juris.config.js
module.exports = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    compression: { enabled: true }
  },
  
  app: {
    title: 'My Juris Application',
    initialState: {
      theme: 'dark',
      user: null
    }
  },
  
  api: {
    prefix: '/api',
    cors: { enabled: true },
    endpoints: {
      '/users': {
        method: 'GET',
        handler: async (req, reply) => {
          return await db.users.findAll();
        }
      }
    }
  },
  
  htmlCache: {
    generation: {
      enabled: true,
      outputDir: 'dist',
      routes: ['/', '/about', '/products'],
      ttl: 300000,
      minifyHTML: true
    }
  },
  
  routes: {
    catchAll: true,
    pages: {
      '/': { title: 'Home' },
      '/about': { title: 'About Us' }
    }
  }
};
```

## 🧪 Testing

Run the comprehensive test suite:

```bash
# Run unit tests
npm test

# Run integration tests  
npm run test:integration

# Run performance tests
npm run test:performance

# Test in browser
open https://jurisjs.com/tests/juris_pure_test_interface.html
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
git clone https://github.com/jurisjs/juris
cd juris
npm install
npm run dev
```

### Code Style

```javascript
// Use compressed object structure with end labels
return {
  div: { className: 'main',
    text: () => getState('reactive.text.value', 'Hello'),
    style: { color: 'red', border: 'solid 1px blue' },
    children: [
      { button: { text: 'static label',
        onClick: () => clickHandler()
      }}, //button
      { input: { type: 'text', min: '1', max: '10',
        value: () => getState('counter.step', 1),
        oninput: (e) => {
          const newStep = parseInt(e.target.value) || 1;
          setState('counter.step', Math.max(1, Math.min(10, newStep)));
        }
      }} //input
    ]
  } //div.main
}; //return
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Special thanks to all contributors and the JavaScript community for inspiration and feedback.

---

**Built with ❤️ by the Juris Team**

*Juris Framework - Making JavaScript reactive, non-blocking, and delightful to work with.*