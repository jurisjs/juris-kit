# Juris API Client & Headless API

> Universal API client that works on both server and client with reactive headless integration

## 🎯 Core Functions

### `createAPIClient(config)` - Universal HTTP Client
Works in browser, Node.js, React Native, and any JavaScript environment.

### `createHeadlessAPI(endpoints, config)` - Reactive API Manager  
Integrates with Juris state system for automatic reactivity and caching.

## 🚀 Quick Examples

### Basic API Client

```javascript
const api = createAPIClient({
  baseURL: 'https://api.example.com',
  defaultHeaders: { 'Authorization': 'Bearer token123' },
  timeout: 5000,
  retries: 2
});

// Use anywhere (browser, server, mobile)
const users = await api.get('/users');
const newUser = await api.post('/users', { name: 'John', email: 'john@example.com' });
```

### Headless API with Juris

```javascript
// 1. Define endpoints
const api = createHeadlessAPI({
  users: { url: '/api/users' },
  createUser: { method: 'POST', url: '/api/users' },
  userPosts: { url: '/api/users/{userId}/posts' }
});

// 2. Register with Juris
const juris = new Juris({
  headlessComponents: { api }
});

// 3. Use in components
const UserList = (props, { api }) => ({
  div: {
    children: () => {
      const { users } = api.endpoints();
      const { data, loading, error } = users;
      
      // Auto-trigger API call
      if (!data && !loading) api.users();
      
      if (loading) return [{ div: { text: 'Loading...' } }];
      if (error) return [{ div: { text: error } }];
      
      return data?.map(user => ({
        div: { 
          text: user.name,
          onclick: () => api.userPosts({ userId: user.id })
        }
      })) || [];
    }
  }
});
```

## 📡 API Client Usage

### Configuration Options

```javascript
const api = createAPIClient({
  baseURL: 'https://api.example.com',
  defaultHeaders: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer token123'
  },
  timeout: 10000,
  retries: 3,
  interceptors: {
    request: async (url, options) => {
      // Add dynamic auth token
      const token = localStorage.getItem('token');
      if (token) {
        options.headers.Authorization = `Bearer ${token}`;
      }
    },
    response: async (response) => {
      // Global error handling
      if (response.status === 401) {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
  }
});
```

### HTTP Methods

```javascript
// GET requests
const users = await api.get('/users');
const user = await api.get('/users/123');
const filtered = await api.get('/users', { 
  headers: { 'X-Filter': 'active' } 
});

// POST requests
const newUser = await api.post('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});

// PUT requests
const updatedUser = await api.put('/users/123', {
  name: 'John Updated'
});

// DELETE requests
await api.delete('/users/123');

// Raw fetch access
const response = await api.fetch('/custom-endpoint', {
  method: 'PATCH',
  body: JSON.stringify(data)
});
```

## 🎛️ Headless API Usage

### Endpoint Definitions

```javascript
const api = createHeadlessAPI({
  // Simple GET
  users: { url: '/api/users' },
  
  // GET with path parameters
  user: { url: '/api/users/{id}' },
  
  // POST with body
  createUser: { method: 'POST', url: '/api/users' },
  
  // Complex endpoint with caching and transformation
  searchPosts: {
    url: '/api/posts/search',
    cache: true,
    transform: (data) => ({
      posts: data.results,
      total: data.count,
      timestamp: Date.now()
    })
  }
});
```

### Parameter Handling

```javascript
// Query parameters (GET)
await api.users({ page: 1, limit: 10, active: true });
// → GET /api/users?page=1&limit=10&active=true

// Path parameters
await api.user({ id: 123 });
// → GET /api/users/123

// Mixed parameters
await api.userPosts({ userId: 123, page: 1, published: true });
// → GET /api/users/123/posts?page=1&published=true

// POST body
await api.createUser({ name: 'John', email: 'john@example.com' });
// → POST /api/users with body

// Array parameters
await api.searchPosts({ 
  tags: ['tutorial', 'javascript'],
  categories: ['web', 'frontend']
});
// → GET /api/posts/search?tags=tutorial&tags=javascript&categories=web&categories=frontend
```

### State Management

```javascript
const UserComponent = (props, { api }) => ({
  div: {
    children: () => {
      // Get current state
      const { users, createUser } = api.endpoints();
      
      return [
        // Show loading state
        users.loading && { div: { text: 'Loading users...' } },
        
        // Show error state
        users.error && { 
          div: { 
            text: `Error: ${users.error}`,
            style: { color: 'red' }
          }
        },
        
        // Show data
        users.data && {
          div: {
            children: users.data.map(user => ({
              div: { text: user.name }
            }))
          }
        },
        
        // Create user form
        {
          form: {
            onsubmit: async (e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              await api.createUser({
                name: formData.get('name'),
                email: formData.get('email')
              });
              // Refresh users list
              api.users();
            },
            children: [
              { input: { name: 'name', placeholder: 'Name', required: true } },
              { input: { name: 'email', type: 'email', placeholder: 'Email', required: true } },
              { button: { type: 'submit', text: 'Create User' } }
            ]
          }
        }
      ].filter(Boolean);
    }
  }
});
```

## 🔄 Real-time Updates

### Auto-refresh Pattern

```javascript
const LiveUserList = (props, { api }) => ({
  div: {
    children: () => {
      const { users } = api.endpoints();
      
      // Load initially
      if (!users.data && !users.loading) {
        api.users();
      }
      
      // Auto-refresh every 30 seconds
      setTimeout(() => {
        if (!users.loading) {
          api.users();
        }
      }, 30000);
      
      return users.data?.map(user => ({
        div: { text: `${user.name} - ${user.status}` }
      })) || [];
    }
  }
});
```

### Cache Management

```javascript
const CacheExample = (props, { api }) => ({
  div: {
    children: [
      {
        button: {
          text: 'Refresh Users',
          onclick: () => api.users({ skipCache: true })
        }
      },
      {
        button: {
          text: 'Clear Cache',
          onclick: () => api.clearCache('users')
        }
      },
      {
        button: {
          text: 'Clear All Cache',
          onclick: () => api.clearCache()
        }
      }
    ]
  }
});
```

## 🌐 Universal Usage Examples

### Browser

```javascript
// In browser components
const api = createAPIClient({
  baseURL: '/api' // Relative to current domain
});

const users = await api.get('/users');
```

### Node.js Server

```javascript
// In server-side code
const api = createAPIClient({
  baseURL: 'https://external-api.com',
  defaultHeaders: {
    'User-Agent': 'MyApp/1.0'
  }
});

async function fetchExternalData(userId) {
  const userData = await api.get(`/users/${userId}`);
  return userData;
}
```

### React Native

```javascript
// In React Native
const api = createAPIClient({
  baseURL: 'https://api.myapp.com',
  defaultHeaders: {
    'X-Platform': 'mobile'
  }
});

// Works identically
const users = await api.get('/users');
```

## 🛠️ Advanced Patterns

### Multi-API Setup

```javascript
// Multiple API sources
const internalAPI = createHeadlessAPI({
  users: { url: '/api/users' },
  posts: { url: '/api/posts' }
}, {
  baseURL: 'https://myapp.com'
});

const externalAPI = createHeadlessAPI({
  weather: { url: '/current' },
  forecast: { url: '/forecast' }
}, {
  baseURL: 'https://weather-api.com',
  defaultHeaders: { 'API-Key': 'weather123' }
});

const juris = new Juris({
  headlessComponents: {
    internal: internalAPI,
    external: externalAPI
  }
});

// Use in components
const Dashboard = (props, { internal, external }) => ({
  div: {
    children: () => {
      const { users } = internal.endpoints();
      const { weather } = external.endpoints();
      
      return [
        { h2: { text: `Users: ${users.data?.length || 0}` } },
        { h2: { text: `Weather: ${weather.data?.temp || 'N/A'}°` } }
      ];
    }
  }
});
```

### Error Handling

```javascript
const ErrorHandlingExample = (props, { api }) => ({
  div: {
    children: () => {
      const { users } = api.endpoints();
      
      if (users.error) {
        return [
          {
            div: {
              text: 'Failed to load users',
              style: { color: 'red' }
            }
          },
          {
            button: {
              text: 'Retry',
              onclick: () => api.users()
            }
          }
        ];
      }
      
      return users.data?.map(user => ({
        div: { text: user.name }
      })) || [];
    }
  }
});
```

### Pagination

```javascript
const PaginatedList = (props, { api, getState, setState }) => ({
  div: {
    children: () => {
      const { users } = api.endpoints();
      const page = getState('pagination.page', 1);
      const limit = getState('pagination.limit', 10);
      
      // Load current page
      if (!users.loading) {
        api.users({ page, limit });
      }
      
      return [
        // User list
        {
          div: {
            children: users.data?.map(user => ({
              div: { text: user.name }
            })) || []
          }
        },
        
        // Pagination controls
        {
          div: {
            children: [
              {
                button: {
                  text: 'Previous',
                  disabled: page <= 1,
                  onclick: () => {
                    setState('pagination.page', page - 1);
                  }
                }
              },
              {
                span: { text: ` Page ${page} ` }
              },
              {
                button: {
                  text: 'Next',
                  onclick: () => {
                    setState('pagination.page', page + 1);
                  }
                }
              }
            ]
          }
        }
      ];
    }
  }
});
```

## 🔧 Configuration Reference

### createAPIClient Options

```javascript
const api = createAPIClient({
  baseURL: 'https://api.example.com',    // Base URL for all requests
  defaultHeaders: {},                     // Default headers for all requests
  timeout: 10000,                        // Request timeout in ms
  retries: 1,                            // Number of retry attempts
  interceptors: {
    request: async (url, options) => {}, // Request interceptor
    response: async (response) => {}     // Response interceptor
  }
});
```

### createHeadlessAPI Options

```javascript
const api = createHeadlessAPI({
  // Endpoint definitions
  users: {
    url: '/api/users',                   // Required: endpoint URL
    method: 'GET',                       // HTTP method (default: GET)
    cache: true,                         // Enable caching
    transform: (data) => data,           // Transform response data
  }
}, {
  // Global configuration (same as createAPIClient)
  baseURL: 'https://api.example.com',
  defaultHeaders: {},
  timeout: 10000,
  retries: 1,
  interceptors: {}
});
```

## 📋 API Reference

### API Client Methods

```javascript
api.get(url, options)          // GET request
api.post(url, data, options)   // POST request  
api.put(url, data, options)    // PUT request
api.delete(url, options)       // DELETE request
api.fetch(url, options)        // Raw fetch
```

### Headless API Methods

```javascript
api.users(params, options)     // Call endpoint
api.endpoints()                // Get all endpoint states
api.clearCache(endpoint)       // Clear cache
api.subscribe(endpoint, cb)    // Subscribe to changes
```

### Endpoint State Structure

```javascript
{
  data: any,           // Response data
  loading: boolean,    // Loading state
  error: string|null   // Error message
}
```

---

**🚀 Ready to build reactive, universal APIs with Juris!**