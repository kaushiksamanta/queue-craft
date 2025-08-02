import { TSchema, Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

/**
 * Validates data against a TypeBox schema
 * @param schema TypeBox schema
 * @param data Data to validate
 * @param errorMessage Optional error message
 * @returns Validated data
 */
export function validateSchema<T extends TSchema>(
  schema: T,
  data: unknown,
  errorMessage?: string,
): Static<T> {
  if (!isValid(schema, data)) {
    const errors = [...Value.Errors(schema, data)]
    const errorDetails = errors.map(error => `${error.path} ${error.message}`).join(', ')

    throw new Error(
      errorMessage ||
        `Validation error: ${JSON.stringify(data)} does not match schema. Errors: ${errorDetails}`,
    )
  }

  return data as Static<T>
}

/**
 * Checks if data is valid against a TypeBox schema
 * @param schema TypeBox schema
 * @param data Data to validate
 * @returns Whether data is valid
 */
export function isValid<T extends TSchema>(schema: T, data: unknown): boolean {
  return Value.Check(schema, data)
}
