const TodosPage = (props, { getState, setState }) => ({
	div: {
		style: { padding: '20px' },
		children: () => [{
			h1: { text: 'Todo List' }
		}, {
			input: {
				type: 'text',
				placeholder: 'Add new todo...',
				onkeypress: (e) => {
					if (e.key === 'Enter') {
						const text = e.target.value.trim();
						if (text) {
							const todos = getState('todos', []);
							setState('todos', [...todos, { id: Date.now(), text, done: false }]);
							e.target.value = '';
						}
					}
				},
				style: { padding: '8px', width: '300px', marginBottom: '16px' }
			}
		}, {
			div: {
				children: () => {
					const todos = getState('todos', []);
					return todos.map(todo => ({
						div: {
							key: todo.id,
							style: {
								padding: '8px',
								border: '1px solid #eee',
								marginBottom: '4px',
								display: 'flex',
								alignItems: 'center'
							},
							children: () => [{
								input: {
									type: 'checkbox',
									checked: todo.done,
									onchange: (e) => {
										const todos = getState('todos', []);
										setState('todos', todos.map(t =>
											t.id === todo.id ? { ...t, done: e.target.checked } : t
										));
									},
									style: { marginRight: '8px' }
								}
							}, {
								span: {
									text: todo.text,
									style: {
										textDecoration: todo.done ? 'line-through' : 'none',
										flex: 1
									}
								}
							}, {
								button: {
									text: 'Delete',
									onclick: () => {
										const todos = getState('todos', []);
										setState('todos', todos.filter(t => t.id !== todo.id));
									},
									style: { padding: '4px 8px', marginLeft: '8px' }
								}
							}]
						}
					}));
				}
			}
		}]
	}
})