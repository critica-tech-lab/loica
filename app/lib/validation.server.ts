import { z } from "zod";

// Common schemas
export const docIdSchema = z.string().min(1).max(64);
export const titleSchema = z.string().max(500).default("");
export const contentSchema = z.string().max(5_000_000);
export const emailSchema = z.string().email().max(254);
export const folderIdSchema = z.string().min(1).max(64);
export const permissionSchema = z.enum(["editor", "viewer"]);

// Helper function to parse and validate form data
export async function parseForm<T>(
  schema: z.ZodSchema<T>,
  formData: FormData
): Promise<T | null> {
  try {
    const data = Object.fromEntries(formData);
    const result = schema.parse(data);
    return result as T;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Validation error:", error.issues);
      return null;
    }
    throw error;
  }
}

// Helper function to throw a 400 response on validation failure
export function throwValidationError(message: string = "Invalid input") {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
