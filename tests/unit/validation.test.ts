import { describe, it, expect, vi } from 'vitest'
import { validateSchema, isValid } from '../../src/utils/validation'
import { Type } from '@sinclair/typebox'

describe('Validation Utils', () => {
  const TestSchema = Type.Object({
    name: Type.String(),
    age: Type.Number(),
    email: Type.Optional(Type.String()),
  })

  describe('validateSchema', () => {
    it('should validate valid data', () => {
      const validData = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
      }

      const result = validateSchema(TestSchema, validData)
      expect(result).toEqual(validData)
    })

    it('should validate valid data with missing optional fields', () => {
      const validData = {
        name: 'John Doe',
        age: 30,
      }

      const result = validateSchema(TestSchema, validData)
      expect(result).toEqual(validData)
    })

    it('should throw error for invalid data', () => {
      const invalidData = {
        name: 'John Doe',
        age: '30', // should be a number
      }

      expect(() => validateSchema(TestSchema, invalidData)).toThrow()
    })

    it('should throw error with custom message', () => {
      const invalidData = {
        name: 'John Doe',
        age: '30', // should be a number
      }

      const customMessage = 'Custom validation error message'
      expect(() => validateSchema(TestSchema, invalidData, customMessage)).toThrow(customMessage)
    })

    it('should throw error for missing required fields', () => {
      const invalidData = {
        name: 'John Doe',
        // missing age field
      }

      expect(() => validateSchema(TestSchema, invalidData)).toThrow()
    })
  })

  describe('isValid', () => {
    it('should return true for valid data', () => {
      const validData = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
      }

      expect(isValid(TestSchema, validData)).toBe(true)
    })

    it('should return true for valid data with missing optional fields', () => {
      const validData = {
        name: 'John Doe',
        age: 30,
      }

      expect(isValid(TestSchema, validData)).toBe(true)
    })

    it('should return false for invalid data', () => {
      const invalidData = {
        name: 'John Doe',
        age: '30', // should be a number
      }

      expect(isValid(TestSchema, invalidData)).toBe(false)
    })

    it('should return false for missing required fields', () => {
      const invalidData = {
        name: 'John Doe',
        // missing age field
      }

      expect(isValid(TestSchema, invalidData)).toBe(false)
    })
  })
})
