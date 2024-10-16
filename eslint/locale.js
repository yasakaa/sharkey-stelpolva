/* This is a ESLint rule to report use of the `i18n.ts` and `i18n.tsx`
 * objects that reference translation items that don't actually exist
 * in the lexicon (the `locale/` files)
 */

/* given a MemberExpression node, collects all the member names
 *
 * e.g. for a bit of code like `foo=one.two.three`, `collectMembers`
 * called on the node for `three` would return `['one', 'two',
 * 'three']`
 */
function collectMembers(node) {
	if (!node) return [];
	if (node.type !== 'MemberExpression') return [];
	return [ node.property.name, ...collectMembers(node.parent) ];
}

/* given an object and an array of names, recursively descends the
 * object via those names
 *
 * e.g. `walkDown({one:{two:{three:15}}},['one','two','three'])` would
 * return 15
 */
function walkDown(locale, path) {
	if (!locale) return null;
	if (!path || path.length === 0) return locale;
	return walkDown(locale[path[0]], path.slice(1));
}

/* given a MemberExpression node, returns its attached CallExpression
 * node if present
 *
 * e.g. for a bit of code like `foo=one.two.three()`,
 * `findCallExpression` called on the node for `three` would return
 * the node for function call (which is the parent of the `one` and
 * `two` nodes, and holds the nodes for the argument list)
 *
 * if the code had been `foo=one.two.three`, `findCallExpression`
 * would have returned null, because there's no function call attached
 * to the MemberExpressions
 */
function findCallExpression(node) {
	if (!node.parent) return null;

	// the second half of this guard protects from cases like
	// `foo(one.two.three)` where the CallExpression is parent of the
	// MemberExpressions, but via `arguments`, not `callee`
	if (node.parent.type === 'CallExpression' && node.parent.callee === node) return node.parent;
	if (node.parent.type === 'MemberExpression') return findCallExpression(node.parent);
	return null;
}

/* the actual rule body
 */
function theRule(context) {
	// we get the locale/translations via the options; it's the data
	// that goes into a specific language's JSON file, see
	// `scripts/build-assets.mjs`
	const locale = context.options[0];
	return {
		// for all object member access that have an identifier 'i18n'...
		'MemberExpression:has(> Identifier[name=i18n])': (node) => {
			// sometimes we get MemberExpression nodes that have a
			// *descendent* with the right identifier: skip them, we'll get
			// the right ones as well
			if (node.object?.name != 'i18n') {
				return;
			}

			// `method` is going to be `'ts'` or `'tsx'`, `path` is going to
			// be the various translation steps/names
			const [ method, ...path ] = collectMembers(node);
			const pathStr = `i18n.${method}.${path.join('.')}`;

			// does that path point to a real translation?
			const matchingNode = walkDown(locale, path);
			if (!matchingNode) {
				context.report({
					node,
					message: `translation missing for ${pathStr}`,
				});
				return;
			}

			// some more checks on how the translation is called
			if (method == 'ts') {
				if (matchingNode.match(/\{/)) {
					context.report({
						node,
						message: `translation for ${pathStr} is parametric, but called via 'ts'`,
					});
					return;
				}

				if (findCallExpression(node)) {
					context.report({
						node,
						message: `translation for ${pathStr} is not parametric, but is called as a function`,
					});
				}
			}

			if (method == 'tsx') {
				if (!matchingNode.match(/\{/)) {
					context.report({
						node,
						message: `translation for ${pathStr} is not parametric, but called via 'tsx'`,
					});
					return;
				}

				const callExpression = findCallExpression(node);

				if (!callExpression) {
					context.report({
						node,
						message: `translation for ${pathStr} is parametric, but not called as a function`,
					});
					return;
				}

				const parameterCount = [...matchingNode.matchAll(/\{/g)].length ?? 0;
				const argumentCount = callExpression.arguments.length;
				if (parameterCount !== argumentCount) {
					context.report({
						node,
						message: `translation for ${pathStr} has ${parameterCount} parameters, but is called with ${argumentCount} arguments`,
					});
					return;
				}
			}
		},
	};
}

module.exports = {
	meta: {
		type: 'problem',
		docs: {
			description: 'assert that all translations used are present in the locale files',
		},
		schema: [
			// here we declare that we need the locale/translation as a
			// generic object
			{ type: 'object', additionalProperties: true },
		],
	},
	create: theRule,
};
