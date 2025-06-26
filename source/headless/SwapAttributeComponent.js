

const SwapAttributeComponent = (props, ctx) => {
	return {
		api: {
			// Public API for manual swapping
			swap: async (url, target) => {
				try {
					const response = await fetch(url);
					const html = await response.text();
					const targetEl = document.querySelector(target);
					if (targetEl) targetEl.innerHTML = html;
					return html;
				} catch (error) {
					console.error('Manual swap failed:', error);
					return null;
				}
			},

			// Get all generated swap JavaScript
			getSwapJavaScript: () => {
				const swapScripts = ctx.getState('_juris.swapScripts', []);
				return swapScripts.join('\n\n');
			},

			// Clear stored JavaScript (after sending to client)
			clearSwapJavaScript: () => {
				ctx.setState('_juris.swapScripts', []);
			}
		},

		hooks: {
			onRegister: () => {
				if (ctx.juris.domRenderer.getType() === 'DOMRenderer') {
					return;
				}
				// Initialize swap scripts array in state
				ctx.setState('_juris.swapScripts', []);

				// Inject the swap handler into DOMRenderer
				ctx.juris.domRenderer.specialAttributeHandlers.set('swap', (element, config) => {
					console.log('Registering swap handler for StringRenderer');

					// Initialize swap scripts array in state
					ctx.setState('_juris.swapScripts', []);

					// Register handler for StringRenderer
					ctx.juris.domRenderer.specialAttributeHandlers.set('swap', (attrName, config) => {
						const swapId = `swap-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

						// Generate JavaScript for this swap
						const swapScript = generateSwapScript(swapId, config);

						// Store in state
						const existingScripts = ctx.getState('_juris.swapScripts', []);
						ctx.setState('_juris.swapScripts', [...existingScripts, swapScript]);

						// Return HTML attributes for StringRenderer
						return ` data-swap-id="${swapId}"`;
					});
				});

				// Generate swap JavaScript function
				function generateSwapScript(swapId, config) {
					const trigger = config.trigger || 'click';
					const url = config.url;
					const target = config.target;
					const method = config.method || 'GET';

					return `
// Swap handler for element: ${swapId}
(function() {
  const element = document.querySelector('[data-swap-id="${swapId}"]');
  if (!element) return;
  
  const swapHandler = async function(e) {
    ${trigger === 'click' ? 'e.preventDefault();' : ''}
    
    try {
      const response = await fetch('${url}', {
        method: '${method}'
      });
      
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }
      
      const html = await response.text();
      const targetEl = document.querySelector('${target}');
      
      if (targetEl) {
        targetEl.innerHTML = html;
      }
      
    } catch (error) {
      console.error('Swap failed for ${swapId}:', error);
    }
  };
  
  ${generateTriggerCode(trigger)}
})();`;
				}

				function generateTriggerCode(trigger) {
					switch (trigger) {
						case 'load':
							return `
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', swapHandler);
  } else {
    setTimeout(swapHandler, 0);
  }`;

						case 'visible':
							return `
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        swapHandler(new Event('visible'));
        observer.disconnect();
      }
    });
  });
  observer.observe(element);`;

						default:
							return `element.addEventListener('${trigger}', swapHandler);`;
					}
				}

				console.log('Swap attribute handler registered');
			},

			onUnregister: () => {
				// Clean up
				ctx.juris.domRenderer.specialAttributeHandlers.delete('swap');
				ctx.setState('_juris.swapScripts', []);
				console.log('Swap attribute handler unregistered');
			}
		}
	};
};