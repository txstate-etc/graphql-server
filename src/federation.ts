/**
 * Adapted from https://github.com/mercurius-js/mercurius while it was displaying an MIT license.
 * This adaptation is also MIT licensed.
 */

/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/naming-convention */
import {
  GraphQLSchema,
  GraphQLObjectType,
  Kind,
  extendSchema,
  parse,
  isTypeDefinitionNode,
  isTypeExtensionNode,
  isObjectType,
  TypeDefinitionNode,
  TypeExtensionNode,
  NameNode,
  DirectiveDefinitionNode,
  GraphQLResolveInfo,
  UniqueDirectivesPerLocationRule
} from 'graphql'
import { specifiedSDLRules } from 'graphql/validation/specifiedRules'
import { validateSDL } from 'graphql/validation/validate'
import { printSchemaWithDirectives } from '@graphql-tools/utils'

type TypeNode = TypeDefinitionNode|TypeExtensionNode|DirectiveDefinitionNode

function hasExtensionDirective (node: any) {
  for (const directive of node.directives ?? []) {
    if (directive === 'extends' || directive === 'requires') return true
  }
  return false
}

const BASE_FEDERATION_TYPES = `
  scalar _Any
  scalar _FieldSet

  directive @external on FIELD_DEFINITION
  directive @requires(fields: _FieldSet!) on FIELD_DEFINITION
  directive @provides(fields: _FieldSet!) on FIELD_DEFINITION
  directive @key(fields: _FieldSet!) on OBJECT | INTERFACE
  directive @extends on OBJECT | INTERFACE
`

const FEDERATION_SCHEMA = `
  ${BASE_FEDERATION_TYPES}
  type _Service {
    sdl: String
  }
`

const extensionKindToDefinitionKind = {
  [Kind.SCALAR_TYPE_EXTENSION]: Kind.SCALAR_TYPE_DEFINITION,
  [Kind.OBJECT_TYPE_EXTENSION]: Kind.OBJECT_TYPE_DEFINITION,
  [Kind.INTERFACE_TYPE_EXTENSION]: Kind.INTERFACE_TYPE_DEFINITION,
  [Kind.UNION_TYPE_EXTENSION]: Kind.UNION_TYPE_DEFINITION,
  [Kind.ENUM_TYPE_EXTENSION]: Kind.ENUM_TYPE_DEFINITION,
  [Kind.INPUT_OBJECT_TYPE_EXTENSION]: Kind.INPUT_OBJECT_TYPE_DEFINITION
}

const definitionKindToExtensionKind = {
  [Kind.SCALAR_TYPE_DEFINITION]: Kind.SCALAR_TYPE_EXTENSION,
  [Kind.OBJECT_TYPE_DEFINITION]: Kind.OBJECT_TYPE_EXTENSION,
  [Kind.INTERFACE_TYPE_DEFINITION]: Kind.INTERFACE_TYPE_EXTENSION,
  [Kind.UNION_TYPE_DEFINITION]: Kind.UNION_TYPE_EXTENSION,
  [Kind.ENUM_TYPE_DEFINITION]: Kind.ENUM_TYPE_EXTENSION,
  [Kind.INPUT_OBJECT_TYPE_DEFINITION]: Kind.INPUT_OBJECT_TYPE_EXTENSION
}

function getStubTypes (schemaDefinitions: TypeNode[]) {
  const definitionsMap: Record<string, TypeDefinitionNode> = {}
  const extensionsMap: Record<string, { kind: string, name: NameNode }> = {}
  const extensions: any[] = []
  const directiveDefinitions: DirectiveDefinitionNode[] = []

  for (const definition of schemaDefinitions) {
    const typeName = definition.name.value
    const isTypeExtensionByDirective = hasExtensionDirective(definition)

    if (isTypeDefinitionNode(definition) && !isTypeExtensionByDirective) {
      definitionsMap[typeName] = definition
    } else if (isTypeExtensionNode(definition) || (isTypeDefinitionNode(definition) && isTypeExtensionByDirective)) {
      extensionsMap[typeName] = {
        kind: isTypeExtensionByDirective ? definition.kind : extensionKindToDefinitionKind[(definition as TypeExtensionNode).kind],
        name: definition.name
      }
      if (isTypeExtensionByDirective) {
        (definition as any).kind = definitionKindToExtensionKind[(definition as TypeDefinitionNode).kind]
      }
    } else if (definition.kind === Kind.DIRECTIVE_DEFINITION) {
      directiveDefinitions.push(definition)
    }
  }

  return {
    typeStubs: Object.keys(extensionsMap)
      .filter(extensionTypeName => !definitionsMap[extensionTypeName])
      .map(extensionTypeName => extensionsMap[extensionTypeName]),
    extensions,
    definitions: [
      ...directiveDefinitions,
      ...Object.values(definitionsMap)
    ]
  }
}

function gatherDirectives (type: any) {
  let directives: any[] = []
  if (type.extensionASTNodes) {
    for (const node of type.extensionASTNodes) {
      if (node.directives) {
        directives = directives.concat(node.directives)
      }
    }
  }

  if (type.astNode?.directives) {
    directives = directives.concat(type.astNode.directives)
  }

  return directives
}

function typeIncludesDirective (type: any, directiveName: string) {
  const directives = gatherDirectives(type)
  return directives.some(directive => directive.name.value === directiveName)
}

function addTypeNameToResult (result: any, typename: string) {
  if (result !== null && typeof result === 'object') {
    Object.defineProperty(result, '__typename', {
      value: typename
    })
  }
  return result
}

function addEntitiesResolver (schema: GraphQLSchema) {
  const entityTypes = Object.values(schema.getTypeMap()).filter(
    type => isObjectType(type) && typeIncludesDirective(type, 'key')
  ) as GraphQLObjectType[]

  if (entityTypes.length > 0) {
    schema = extendSchema(schema, parse(`
      union _Entity = ${entityTypes.join(' | ')}

      extend type Query {
        _entities(representations: [_Any!]!): [_Entity]!
      }
    `), {
      assumeValid: true
    })

    const query = schema.getType('Query') as GraphQLObjectType
    const queryFields = query.getFields()
    queryFields._entities = {
      ...queryFields._entities,
      resolve: (_source: any, { representations }: any, context: any, info: GraphQLResolveInfo) => {
        return representations.map((reference: any) => {
          const { __typename } = reference

          const result = resolveMap[__typename]?.(reference, {}, context, info) ?? reference

          if (typeof result?.then === 'function') {
            return result.then((x: any) => addTypeNameToResult(x, __typename))
          }

          return addTypeNameToResult(result, __typename)
        })
      }
    }
  }

  return schema
}

function addServiceResolver (schema: any, originalSchemaSDL: any) {
  schema = extendSchema(schema, parse(`
    extend type Query {
      _service: _Service!
    }
  `), {
    assumeValid: true
  })
  const query = schema.getType('Query')

  const queryFields = query.getFields()
  queryFields._service = {
    ...queryFields._service,
    resolve: () => ({ sdl: originalSchemaSDL })
  }

  return schema
}

export function buildFederationSchema (schema: GraphQLSchema) {
  const originalSchemaSDL = printSchemaWithDirectives(schema)
    /* these 3 lines are required only for compatibility with mercurius gateway */
    .replace(/schema\s?{[\s\S]*?}\s*/, '')
    .replace(/^type Query/m, 'extend type Query')
    .replace(/^type Mutation/m, 'extend type Mutation')
  const { typeStubs, extensions, definitions } = getStubTypes(Object.values(schema.getTypeMap()) as any)

  let federationSchema = extendSchema(
    schema,
    parse(FEDERATION_SCHEMA),
    { assumeValidSDL: true }
  )

  // Add type stubs - only needed for federation
  federationSchema = extendSchema(federationSchema, {
    kind: Kind.DOCUMENT,
    definitions: typeStubs as any
  }, { assumeValidSDL: true })

  // Add default type definitions
  federationSchema = extendSchema(federationSchema, {
    kind: Kind.DOCUMENT,
    definitions
  }, { assumeValidSDL: true })

  // Add all extensions
  const extensionsDocument = {
    kind: Kind.DOCUMENT as Kind.DOCUMENT,
    definitions: extensions
  }

  // instead of relying on extendSchema internal validations
  // we run validations in our code so that we can use slightly different rules
  // as extendSchema internal rules are meant for regular usage
  // and federated schemas have different constraints
  const errors = validateSDL(extensionsDocument, federationSchema, specifiedSDLRules.filter(rule => rule !== UniqueDirectivesPerLocationRule))
  if (errors.length === 1) {
    throw errors[0]
  } else if (errors.length > 1) {
    const err = new Error('Federated Schema is not valid.');
    (err as any).errors = errors
    throw err
  }

  federationSchema = extendSchema(federationSchema, extensionsDocument, { assumeValidSDL: true })

  if (!federationSchema.getType('Query')) {
    federationSchema = new GraphQLSchema({
      ...federationSchema.toConfig(),
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {}
      })
    })
  }

  federationSchema = addEntitiesResolver(federationSchema)
  federationSchema = addServiceResolver(federationSchema, originalSchemaSDL)

  return new GraphQLSchema({
    ...federationSchema.toConfig(),
    query: federationSchema.getType('Query') as any,
    mutation: federationSchema.getType('Mutation') as any,
    subscription: federationSchema.getType('Subscription') as any
  })
}

const resolveMap: Record<string, Function> = {}
export function ResolveReference (typename: string): MethodDecorator {
  return (prototype, key) => {
    if (typeof key === 'symbol') return
    resolveMap[typename] = (prototype as any)[key]
  }
}
