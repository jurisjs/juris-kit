// /config/api.model.js
module.exports = {
	users: {
		findAll: async (queryParams = {}) => {
			// Database query to get all users
			return [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }];
		},

		findById: async (id) => {
			// Database query to get user by ID
			return { id: parseInt(id), name: 'John Doe' };
		},

		create: async (userData) => {
			// Database query to create user
			return { id: 3, ...userData };
		},

		update: async (id, userData) => {
			// Database query to update user
			return { id: parseInt(id), ...userData };
		},

		delete: async (id) => {
			// Database query to delete user
			return { success: true, id: parseInt(id) };
		},

		getPosts: async (userId) => {
			// Get posts for a specific user
			return [{ id: 1, userId: parseInt(userId), title: 'Post 1' }];
		}
	},

	posts: {
		findAll: async () => { /* DB query */ },
		findById: async (id) => { /* DB query */ },
		create: async (data) => { /* DB query */ },
		// ... other methods
	}
};