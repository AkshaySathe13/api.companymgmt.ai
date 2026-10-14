# Working in this repository

- Read README.md and docs/ARCHITECTURE.md before changing module boundaries.
- Keep business features under src/modules; request schemas reject unknown writable fields.
- Change prisma/schema.prisma and generate a migration; do not edit generated client files.
- Keep docs/openapi.json aligned with routes and the frontend contract.
- Run npm run check and npm run build. Database changes also require dedicated _test database integration checks.
- Preserve the production startup guard until authentication, authorization, and tenant isolation are implemented and tested.
- Never print credentials or commit .env, generated output, or dependencies.
- This repository is independent of its sibling frontend; do not add relative cross-repo runtime imports.
