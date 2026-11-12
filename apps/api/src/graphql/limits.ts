import {
  GraphQLError,
  Kind,
  type DocumentNode,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from 'graphql';

export interface QueryLimits {
  /** Deepest allowed nesting of fields. */
  maxDepth: number;
  /** Most fields in one operation, counting every alias and every expanded fragment. */
  maxFields: number;
  /** Most top-level fields in one operation. Each one runs its own resolver and database work. */
  maxRootFields: number;
}

export const DEFAULT_QUERY_LIMITS: QueryLimits = {
  maxDepth: 10,
  maxFields: 250,
  maxRootFields: 10,
};

interface Shape {
  depth: number;
  fields: number;
}

const isIntrospection = (name: string) => name.startsWith('__');

/**
 * Refuses queries that are legal but expensive: thousands of aliases of the same field,
 * very deep nesting, or fragments that multiply each other. Measured on the parsed document,
 * before any resolver runs. Introspection (`__schema`, `__type`) is not counted.
 */
export function queryLimitsRule(limits: QueryLimits = DEFAULT_QUERY_LIMITS): ValidationRule {
  return (context: ValidationContext) => {
    const document: DocumentNode = context.getDocument();
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of document.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
    }

    // Memoised, so a chain of fragments that each spread the previous one twice is measured once.
    const memo = new Map<string, Shape>();
    const visiting = new Set<string>();

    const measure = (set: SelectionSetNode): Shape => {
      let depth = 0;
      let fields = 0;
      for (const selection of set.selections) {
        if (selection.kind === Kind.FIELD) {
          if (isIntrospection(selection.name.value)) continue;
          const inner = selection.selectionSet
            ? measure(selection.selectionSet)
            : { depth: 0, fields: 0 };
          depth = Math.max(depth, 1 + inner.depth);
          fields += 1 + inner.fields;
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          const inner = measure(selection.selectionSet);
          depth = Math.max(depth, inner.depth);
          fields += inner.fields;
        } else {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (!fragment || visiting.has(name)) continue; // unknown / cyclic: other rules report it
          let inner = memo.get(name);
          if (!inner) {
            visiting.add(name);
            inner = measure(fragment.selectionSet);
            visiting.delete(name);
            memo.set(name, inner);
          }
          depth = Math.max(depth, inner.depth);
          fields += inner.fields;
        }
      }
      return { depth, fields };
    };

    const reject = (message: string) =>
      context.reportError(new GraphQLError(message, { extensions: { code: 'BAD_REQUEST' } }));

    for (const def of document.definitions) {
      if (def.kind !== Kind.OPERATION_DEFINITION) continue;
      const shape = measure(def.selectionSet);
      const rootFields = def.selectionSet.selections.filter(
        (s) => s.kind !== Kind.FIELD || !isIntrospection(s.name.value),
      ).length;
      if (shape.depth > limits.maxDepth) {
        reject(`Query is too deep (${shape.depth} levels; the limit is ${limits.maxDepth})`);
      } else if (shape.fields > limits.maxFields) {
        reject(`Query is too large (${shape.fields} fields; the limit is ${limits.maxFields})`);
      } else if (rootFields > limits.maxRootFields) {
        reject(
          `Query asks for too many things at once (${rootFields}; the limit is ${limits.maxRootFields})`,
        );
      }
    }
    return {};
  };
}

export function useQueryLimits(limits: QueryLimits = DEFAULT_QUERY_LIMITS) {
  const rule = queryLimitsRule(limits);
  return {
    onValidate({ addValidationRule }: { addValidationRule: (rule: ValidationRule) => void }) {
      addValidationRule(rule);
    },
  };
}
