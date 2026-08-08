---
name: Protocol console compatibility
description: Compatibility constraints encountered while generating typed API validation for the protocol console.
---

The workspace's generated Zod validators must avoid OpenAPI integer schemas because the installed Zod runtime does not expose the generated `zod.int()` helper; use numeric schemas for count-like fields when maintaining this API generation setup.

**Why:** Code generation succeeded, but the chained library typecheck failed until the integer fields were represented as numbers.

**How to apply:** When extending the protocol OpenAPI contract, prefer the existing generated-client compatibility pattern unless the workspace Zod/Orval versions are upgraded together.