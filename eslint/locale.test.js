const {RuleTester} = require("eslint");
const localeRule = require("./locale");

const locale = { foo: { bar: 'ok', baz: 'good {x}' }, top: '123' };

const ruleTester = new RuleTester();

ruleTester.run(
  'sharkey-locale',
  localeRule,
  {
    valid: [
      {code: 'i18n.ts.foo.bar', options: [locale] },
      // we don't detect the problem here, but should still accept it
      {code: 'i18n.ts.foo["something"]', options: [locale] },
      {code: 'i18n.ts.top', options: [locale] },
      {code: 'i18n.tsx.foo.baz({x:1})', options: [locale] },
      {code: 'whatever.i18n.ts.blah.blah', options: [locale] },
      {code: 'whatever.i18n.tsx.does.not.matter', options: [locale] },
      {code: 'whatever(i18n.ts.foo.bar)', options: [locale] },
    ],
    invalid: [
      {code: 'i18n.ts.not', options: [locale], errors: 1 },
      {code: 'i18n.tsx.deep.not', options: [locale], errors: 1 },
      {code: 'i18n.tsx.deep.not({x:12})', options: [locale], errors: 1 },
      {code: 'i18n.tsx.top({x:1})', options: [locale], errors: 1 },
      {code: 'i18n.ts.foo.baz', options: [locale], errors: 1 },
      {code: 'i18n.tsx.foo.baz', options: [locale], errors: 1 },
      {code: 'i18n.tsx.foo.baz({y:2})', options: [locale], errors: 2 },
    ],
  },
);

