// @flow

import {
  isIdentifier,
  isMemberExpression,
  isImportDefaultSpecifier,
  memberExpression,
  callExpression,
  identifier
} from 'babel-types';
import parse from 'babel-literal-to-ast';
import gql from 'graphql-tag';
import createDebug from 'debug';

const debug = createDebug('babel-plugin-graphql-tag');

export default () => {
  const compile = (path: Object) => {
    const source = path.node.quasis.reduce((head, quasi) => {
      return head + quasi.value.raw;
    }, '');

    const expressions = path.get('expressions');

    expressions.forEach((expr) => {
      if (!isIdentifier(expr) && !isMemberExpression(expr)) {
        throw expr.buildCodeFrameError('Only identifiers or member expressions are allowed by this plugin as an interpolation in a graphql template literal.');
      }
    });

    debug('compiling a GraphQL query', source);

    const queryDocument = gql(source);

    // If a document contains only one operation, that operation may be unnamed:
    // https://facebook.github.io/graphql/#sec-Language.Query-Document
    if (queryDocument.definitions.length > 1) {
      for (const definition of queryDocument.definitions) {
        if (!definition.name) {
          throw new Error('GraphQL query must have name.');
        }
      }
    }

    const body = parse(queryDocument);

    if (expressions.length) {
      const definitionsProperty = body.properties.find((property) => {
        return property.key.value === 'definitions';
      });

      const definitionsArray = definitionsProperty.value;

      const extraDefinitions = expressions.map((expr) => {
        return memberExpression(expr.node, identifier('definitions'));
      });

      definitionsProperty.value = callExpression(
        memberExpression(definitionsArray, identifier('concat')),
        extraDefinitions
      );
    }

    debug('created a static representation', body);

    return body;
  };

  return {
    visitor: {
      Program (programPath: Object) {
        const tagNames = [];

        programPath.traverse({
          ImportDeclaration (path: Object) {
            if (path.node.source.value === 'graphql-tag') {
              const defaultSpecifier = path.node.specifiers.find((specifier) => {
                return isImportDefaultSpecifier(specifier);
              }
              );

              if (defaultSpecifier) {
                tagNames.push(defaultSpecifier.local.name);

                if (path.node.specifiers.length === 1) {
                  path.remove();
                } else {
                  path.node.specifiers = path.node.specifiers.filter(
                    (specifier) => {
                      return specifier !== defaultSpecifier;
                    }
                  );
                }
              }
            }
          },
          TaggedTemplateExpression (path: Object) {
            if (tagNames.some((name) => {
              return isIdentifier(path.node.tag, {name});
            })) {
              try {
                debug('quasi', path.node.quasi);

                const body = compile(path.get('quasi'));

                path.replaceWith(body);
              } catch (error) {
                // eslint-disable-next-line no-console
                console.error('error', error);
              }
            }
          }
        });
      }
    }
  };
};
