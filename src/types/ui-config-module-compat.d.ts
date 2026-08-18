import "@/lib/ui-config/config-builder";
import "@/lib/ui-config/config-validator";

declare module "@/lib/ui-config/config-builder" {
  interface CreateConfigOptions {
    tags?: string[];
  }
}

declare module "@/lib/ui-config/config-validator" {
  interface ValidationError {
    path?: string;
  }
}
