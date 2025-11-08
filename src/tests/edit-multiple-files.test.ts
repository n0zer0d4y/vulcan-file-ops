import { EditFileArgsSchema, EditFileRequestSchema } from '../types/index.js';

describe('edit_multiple_files', () => {
  describe('Schema validation', () => {
    test('accepts single-file format (backward compatibility)', () => {
      const input = {
        path: 'test.txt',
        edits: [{
          oldText: 'old',
          newText: 'new'
        }]
      };

      const result = EditFileArgsSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('single');
        expect(result.data.path).toBe('test.txt');
      }
    });

    test('accepts multi-file format', () => {
      const input = {
        mode: 'multiple',
        files: [
          {
            path: 'test1.txt',
            edits: [{
              oldText: 'old1',
              newText: 'new1'
            }]
          },
          {
            path: 'test2.txt',
            edits: [{
              oldText: 'old2',
              newText: 'new2'
            }]
          }
        ],
        failFast: true
      };

      const result = EditFileArgsSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('multiple');
        expect(result.data.files).toHaveLength(2);
      }
    });

    test('defaults to single mode when mode not specified', () => {
      const input = {
        path: 'test.txt',
        edits: [{
          oldText: 'old',
          newText: 'new'
        }]
      };

      const result = EditFileArgsSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('single');
      }
    });

    test('validates file limits (max 50)', () => {
      const files = Array.from({ length: 51 }, (_, i) => ({
        path: `test${i}.txt`,
        edits: [{ oldText: 'old', newText: 'new' }]
      }));

      const input = { mode: 'multiple', files };
      const result = EditFileArgsSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('Maximum 50 files');
    });

    test('requires at least one file for multi-file mode', () => {
      const input = {
        mode: 'multiple',
        files: []
      };

      const result = EditFileArgsSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('At least one file');
    });

    test('validates individual file requests', () => {
      const input = {
        mode: 'multiple',
        files: [
          {
            path: 'test.txt',
            edits: [] // Empty edits array should fail
          }
        ]
      };

      const result = EditFileArgsSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('At least one edit');
    });

    test('requires path and edits for single mode', () => {
      const input = {
        mode: 'single'
        // Missing path and edits
      };

      const result = EditFileArgsSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('required for single mode');
    });

    test('requires files for multiple mode', () => {
      const input = {
        mode: 'multiple'
        // Missing files
      };

      const result = EditFileArgsSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('required for multiple mode');
    });
  });

  describe('EditFileRequestSchema', () => {
    test('validates complete file request', () => {
      const input = {
        path: 'test.txt',
        edits: [{
          oldText: 'old text',
          newText: 'new text',
          instruction: 'Update text',
          expectedOccurrences: 1
        }],
        matchingStrategy: 'auto',
        dryRun: false,
        failOnAmbiguous: true
      };

      const result = EditFileRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    test('provides defaults for optional fields', () => {
      const input = {
        path: 'test.txt',
        edits: [{
          oldText: 'old',
          newText: 'new'
        }]
      };

      const result = EditFileRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.matchingStrategy).toBe('auto');
        expect(result.data.dryRun).toBe(false);
        expect(result.data.failOnAmbiguous).toBe(true);
      }
    });
  });
});
