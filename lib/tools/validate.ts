/**
 * 工具参数校验（JSON Schema 最小子集）
 *
 * 设计：
 * - 不引入 zod，手写覆盖工具参数常用的 schema 字段；
 * - 只校验"是否存在 / 类型 / 范围"，不做类型转换；
 * - MAX_DEPTH 防止嵌套过深（工具参数不应深嵌套，超过视为异常输入）。
 *
 * 覆盖字段：type（支持类型数组，如 ['object', 'null'] 声明可空）/ required / properties /
 *           enum / minimum / maximum / minLength / maxLength / items。
 * 未覆盖字段（oneOf/anyOf/$ref 等）静默跳过——JSON Schema 是"未声明即允许"。
 */
import type { JSONSchemaObject } from './types.ts';

export type ValidationResult =
  { valid: true; value: Record<string, unknown> } | { valid: false; errors: string[] };

/** 嵌套最大深度（防御性上限） */
const MAX_DEPTH = 5;

/** 校验工具调用参数 */
export function validateArguments(schema: JSONSchemaObject, value: unknown): ValidationResult {
  if (!isPlainObject(value)) {
    return { valid: false, errors: ['参数必须是 JSON 对象'] };
  }
  const errors: string[] = [];
  validateNode(schema, value, '$', errors, 0);
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value };
}

function validateNode(
  schema: JSONSchemaObject,
  value: unknown,
  path: string,
  errors: string[],
  depth: number
): void {
  if (depth > MAX_DEPTH) {
    errors.push(`${path}: 嵌套超过 ${MAX_DEPTH} 层`);
    return;
  }

  // enum 优先：值必须在枚举内
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: 必须是 [${schema.enum.map((e) => JSON.stringify(e)).join(', ')}] 之一`);
    return;
  }

  // type 校验（type 可为数组：命中任一即通过，用于 ['object', 'null'] 这类可空声明）
  const types = normalizeTypes(schema.type);
  if (types.length > 0 && !types.some((t) => matchesType(t, value))) {
    errors.push(`${path}: 期望 ${types.join('|')}，实际 ${describeType(value)}`);
    return;
  }

  // 数值范围
  if ((types.includes('number') || types.includes('integer')) && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: 不能小于 ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: 不能大于 ${schema.maximum}`);
    }
  }

  // 字符串长度
  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: 长度不能小于 ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: 长度不能大于 ${schema.maxLength}`);
    }
  }

  // 对象：必填 + 逐字段递归
  if (types.includes('object') && isPlainObject(value)) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push(`${path}.${key}: 缺少必填字段`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          validateNode(subSchema, value[key], `${path}.${key}`, errors, depth + 1);
        }
      }
    }
  }

  // 数组：逐项递归
  if (types.includes('array') && Array.isArray(value)) {
    const itemSchema = schema.items;
    if (itemSchema) {
      value.forEach((item, i) => {
        validateNode(itemSchema, item, `${path}[${i}]`, errors, depth + 1);
      });
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** type 归一为数组：单值 → [单值]，缺省 → []（未声明即不校验） */
function normalizeTypes(type: JSONSchemaObject['type']): string[] {
  if (!type) return [];
  return Array.isArray(type) ? type : [type];
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      // 未知 type 不拦截（JSON Schema 未声明即允许）
      return true;
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
