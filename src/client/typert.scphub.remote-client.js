/* Handwritten mirror of the typert remote-client artifact for the `scpHub`
 * namespace. Regenerate from the controller (dsh typert generator) when the
 * method surface changes; keep schemas in lockstep with src/scphub/remote.ts. */
import { z } from 'zod'

let _scphub_catalogItem$schema$value
const _scphub_catalogItem$schema = () => (_scphub_catalogItem$schema$value ??= z.object({
  'id': z.string().readonly(),
  'type': z.union([z.literal('scp'), z.literal('skill')]).readonly(),
  'name': z.string().readonly(),
  'description': z.string().readonly(),
  'publisher': z.string().readonly(),
  'tags': z.array(z.string()).readonly(),
  'official': z.boolean().readonly(),
  'viewCount': z.number().readonly(),
  'downloadCount': z.number().readonly(),
  'invocationCount': z.number().readonly(),
  'toolsCount': z.union([z.literal(null), z.number()]).readonly(),
}))

let _scphub_search_result$schema$value
const _scphub_search_result$schema = () => (_scphub_search_result$schema$value ??= z.object({
  'total': z.number().readonly(),
  'page': z.number().readonly(),
  'pageSize': z.number().readonly(),
  'items': z.array(_scphub_catalogItem$schema()).readonly(),
}))

let _scphub_search_parameter_0$schema$value
const _scphub_search_parameter_0$schema = () => (_scphub_search_parameter_0$schema$value ??= z.union([z.literal('scp'), z.literal('skill')]).readonly())

let _scphub_search_parameter_1$schema$value
const _scphub_search_parameter_1$schema = () => (_scphub_search_parameter_1$schema$value ??= z.union([z.literal(null), z.string()]).readonly())

let _scphub_search_parameter_2$schema$value
const _scphub_search_parameter_2$schema = () => (_scphub_search_parameter_2$schema$value ??= z.number().readonly())

let _scphub_scpDetail_result$schema$value
const _scphub_scpDetail_result$schema = () => (_scphub_scpDetail_result$schema$value ??= z.object({
  'id': z.string().readonly(),
  'name': z.string().readonly(),
  'description': z.string().readonly(),
  'publisher': z.string().readonly(),
  'endpoint': z.string().readonly(),
  'offline': z.boolean().readonly(),
  'tools': z.array(z.object({
    'name': z.string().readonly(),
    'description': z.string().readonly(),
  })).readonly(),
}))

let _scphub_scpDetail_parameter_0$schema$value
const _scphub_scpDetail_parameter_0$schema = () => (_scphub_scpDetail_parameter_0$schema$value ??= z.string().readonly())

let _scphub_skillDetail_result$schema$value
const _scphub_skillDetail_result$schema = () => (_scphub_skillDetail_result$schema$value ??= z.object({
  'id': z.string().readonly(),
  'name': z.string().readonly(),
  'description': z.string().readonly(),
  'publisher': z.string().readonly(),
  'offline': z.boolean().readonly(),
  'hasToolkit': z.boolean().readonly(),
}))

let _scphub_skillDetail_parameter_0$schema$value
const _scphub_skillDetail_parameter_0$schema = () => (_scphub_skillDetail_parameter_0$schema$value ??= z.string().readonly())

let _scphub_addScp_parameter_0$schema$value
const _scphub_addScp_parameter_0$schema = () => (_scphub_addScp_parameter_0$schema$value ??= z.string().readonly())

let _scphub_installSkill_parameter_0$schema$value
const _scphub_installSkill_parameter_0$schema = () => (_scphub_installSkill_parameter_0$schema$value ??= z.string().readonly())

let _scphub_installSkill_result$schema$value
const _scphub_installSkill_result$schema = () => (_scphub_installSkill_result$schema$value ??= z.object({
  'id': z.string().readonly(),
  'skillName': z.string().readonly(),
  'name': z.string().readonly(),
  'description': z.string().readonly(),
}))

let _scphub_removeSkill_parameter_0$schema$value
const _scphub_removeSkill_parameter_0$schema = () => (_scphub_removeSkill_parameter_0$schema$value ??= z.string().readonly())

let _scphub_removeSkill_result$schema$value
const _scphub_removeSkill_result$schema = () => (_scphub_removeSkill_result$schema$value ??= z.void())

let _scphub_builtinSkills_result$schema$value
const _scphub_builtinSkills_result$schema = () => (_scphub_builtinSkills_result$schema$value ??= z.array(z.object({
  'name': z.string().readonly(),
  'description': z.string().readonly(),
})).readonly())

export const TYPERT_REMOTE = {
  package: 'dsh-plugin-inkstone',
  descriptors: [
    {
      id: 'dsh-plugin-inkstone#scpHub/search',
      service: 'scpHubController',
      namespace: 'scpHub',
      method: 'search',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'type',
          wire: 'type',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-plugin-inkstone#scpHub/search:type',
            create: _scphub_search_parameter_0$schema,
          },
        },
        {
          name: 'keyword',
          wire: 'keyword',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-plugin-inkstone#scpHub/search:keyword',
            create: _scphub_search_parameter_1$schema,
          },
        },
        {
          name: 'page',
          wire: 'page',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-plugin-inkstone#scpHub/search:page',
            create: _scphub_search_parameter_2$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-plugin-inkstone#scpHub/search:result',
        create: _scphub_search_result$schema,
      },
      sourceLocation: { file: 'src/scphub/remote.ts', line: 96, column: 3 },
    },
    {
      id: 'dsh-plugin-inkstone#scpHub/scpDetail',
      service: 'scpHubController',
      namespace: 'scpHub',
      method: 'scpDetail',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'id',
          wire: 'id',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-plugin-inkstone#scpHub/scpDetail:id',
            create: _scphub_scpDetail_parameter_0$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-plugin-inkstone#scpHub/scpDetail:result',
        create: _scphub_scpDetail_result$schema,
      },
      sourceLocation: { file: 'src/scphub/remote.ts', line: 110, column: 3 },
    },
    {
      id: 'dsh-plugin-inkstone#scpHub/skillDetail',
      service: 'scpHubController',
      namespace: 'scpHub',
      method: 'skillDetail',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'id',
          wire: 'id',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-plugin-inkstone#scpHub/skillDetail:id',
            create: _scphub_skillDetail_parameter_0$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-plugin-inkstone#scpHub/skillDetail:result',
        create: _scphub_skillDetail_result$schema,
      },
      sourceLocation: { file: 'src/scphub/remote.ts', line: 124, column: 3 },
    },
    {
      id: 'dsh-plugin-inkstone#scpHub/addScp',
      service: 'scpHubController',
      namespace: 'scpHub',
      method: 'addScp',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'id',
          wire: 'id',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-plugin-inkstone#scpHub/addScp:id',
            create: _scphub_addScp_parameter_0$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-plugin-inkstone#scpHub/addScp:result',
        create: _scphub_scpDetail_result$schema,
      },
      sourceLocation: { file: 'src/scphub/remote.ts', line: 141, column: 3 },
    },
    {
      id: 'dsh-plugin-inkstone#scpHub/installSkill',
      service: 'scpHubController',
      namespace: 'scpHub',
      method: 'installSkill',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'id',
          wire: 'id',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-plugin-inkstone#scpHub/installSkill:id',
            create: _scphub_installSkill_parameter_0$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-plugin-inkstone#scpHub/installSkill:result',
        create: _scphub_installSkill_result$schema,
      },
      sourceLocation: { file: 'src/scphub/remote.ts', line: 157, column: 3 },
    },
    {
      id: 'dsh-plugin-inkstone#scpHub/removeSkill',
      service: 'scpHubController',
      namespace: 'scpHub',
      method: 'removeSkill',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'id',
          wire: 'id',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-plugin-inkstone#scpHub/removeSkill:id',
            create: _scphub_removeSkill_parameter_0$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-plugin-inkstone#scpHub/removeSkill:result',
        create: _scphub_removeSkill_result$schema,
      },
      sourceLocation: { file: 'src/scphub/remote.ts', line: 178, column: 3 },
    },
    {
      id: 'dsh-plugin-inkstone#scpHub/builtinSkills',
      service: 'scpHubController',
      namespace: 'scpHub',
      method: 'builtinSkills',
      invocation: { kind: 'direct' },
      parameters: [],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-plugin-inkstone#scpHub/builtinSkills:result',
        create: _scphub_builtinSkills_result$schema,
      },
      sourceLocation: { file: 'src/scphub/remote.ts', line: 1, column: 3 },
    },
  ],
}

export default TYPERT_REMOTE
